// The backend the UI starts: the Python sidecar, or the Rust core run inside the app (#285).
// Both are given to sidecarSession.js through the shell plugin's Command interface (on("error"),
// on("close"), stdout/stderr on("data"), spawn() giving a child with write() and kill()), so
// the session rules stay one. The app answers backend_kind: "core" when VRCT_BACKEND=core.

// How the run ended, as the shell plugin's "close" event reports it.
export interface BackendExit {
    code: number | null;
    signal: number | null;
}

export interface BackendCommandEvents {
    close: BackendExit;
    error: unknown;
}

export interface BackendStreamEvents {
    data: string;
}

export interface BackendStream {
    on<K extends keyof BackendStreamEvents>(event: K, listener: (value: BackendStreamEvents[K]) => void): unknown;
}

export interface BackendChild {
    pid: number;
    write(line: string): Promise<unknown>;
    kill(): Promise<unknown>;
}

// The part of the shell plugin's Command the session uses.
export interface BackendCommand {
    on<K extends keyof BackendCommandEvents>(event: K, listener: (value: BackendCommandEvents[K]) => void): BackendCommand;
    stdout: BackendStream;
    stderr: BackendStream;
    spawn(): Promise<BackendChild>;
}

// What the app answers to backend_kind.
export type BackendKind = "core" | "sidecar";

// Tauri's invoke and Channel, given by the caller.
export type BackendInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type BackendChannelConstructor = new <T>() => { onmessage: (message: T) => void };

type ListenerLists<E> = { [K in keyof E]?: Array<(value: E[K]) => void> };

const register = <E, K extends keyof E>(list: ListenerLists<E>, event: K, listener: (value: E[K]) => void) => {
    (list[event] ??= []).push(listener);
};

export interface CoreBackendCommandOptions {
    invoke: BackendInvoke;
    Channel: BackendChannelConstructor;
    newSessionId: () => string;
}

// The Rust core: lines arrive through a Tauri channel in order; the end of the run as its code.
export const createCoreBackendCommand = ({ invoke, Channel, newSessionId }: CoreBackendCommandOptions): BackendCommand => {
    const own: ListenerLists<BackendCommandEvents> = {};
    const out: ListenerLists<BackendStreamEvents> = {};
    const err: ListenerLists<BackendStreamEvents> = {};
    const emit = <E, K extends keyof E>(list: ListenerLists<E>, event: K, value: E[K]) =>
        (list[event] ?? []).forEach(listener => listener(value));
    const command: BackendCommand = {
        on(event, listener) {
            register(own, event, listener);
            return command;
        },
        stdout: { on: (event, listener) => register(out, event, listener) },
        stderr: { on: (event, listener) => register(err, event, listener) },
        async spawn() {
            const session = newSessionId();
            const lines = new Channel<string>();
            lines.onmessage = line => emit(out, "data", line);
            const exit = new Channel<number | null>();
            exit.onmessage = code => emit(own, "close", { code, signal: null });
            await invoke("backend_start", { session, lines, exit });
            return {
                pid: 0,
                // The core takes one request per call; the newline the sidecar needed is not sent.
                write: async (line: string) => {
                    await invoke("backend_write", { session, line: String(line).replace(/\r?\n$/, "") });
                    return true;
                },
                kill: () => invoke("backend_kill", { session }),
            };
        },
    };
    return command;
};

export interface SelectedBackendCommandOptions extends CoreBackendCommandOptions {
    createSidecar: () => BackendCommand;
}

// A listener kept before the backend is known: its stream (null for the command itself), event and function.
type RegisteredListener = [null | "stdout" | "stderr", string, (value: never) => void];
type ListenerTarget = { on(event: string, listener: (value: unknown) => void): unknown };

// Listeners are kept until spawn() knows which backend to start, then handed to it.
export const createSelectedBackendCommand = ({ invoke, Channel, createSidecar, newSessionId }: SelectedBackendCommandOptions): BackendCommand => {
    const registered: RegisteredListener[] = [];
    const proxy: BackendCommand = {
        on(event, listener) {
            registered.push([null, event, listener]);
            return proxy;
        },
        stdout: { on: (event, listener) => registered.push(["stdout", event, listener]) },
        stderr: { on: (event, listener) => registered.push(["stderr", event, listener]) },
        async spawn() {
            let kind: BackendKind = "sidecar";
            try {
                kind = await invoke<BackendKind>("backend_kind");
            } catch (error) {
                console.error("backend_kind failed; starting the sidecar", error);
            }
            const command = kind === "core"
                ? createCoreBackendCommand({ invoke, Channel, newSessionId })
                : createSidecar();
            for (const [stream, event, listener] of registered) {
                // Each listener goes back under the event it was registered for, so its value type matches.
                ((stream === null ? command : command[stream]) as ListenerTarget).on(event, listener as (value: unknown) => void);
            }
            return command.spawn();
        },
    };
    return proxy;
};
