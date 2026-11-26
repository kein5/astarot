// The backend the UI starts: the Rust core run inside the app (#285). It is given to
// sidecarSession.js in the shape of the shell plugin's Command interface that the Python sidecar
// used (on("error"), on("close"), stdout/stderr on("data"), spawn() giving a child with write()
// and kill()), so the session rules stayed the same when the sidecar went.

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


// Tauri's invoke and Channel, given by the caller.
export type BackendInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type BackendChannelConstructor = new <T>() => { onmessage: (message: T) => void };

type ListenerLists<E> = { [K in keyof E]?: Array<(value: E[K]) => void> };

const register = <E, K extends keyof E>(list: ListenerLists<E>, event: K, listener: (value: E[K]) => void) => {
    const listeners = list[event] ?? [];
    list[event] = listeners;
    listeners.push(listener);
};

export interface CoreBackendCommandOptions {
    invoke: BackendInvoke;
    Channel: BackendChannelConstructor;
    newSessionId: () => string;
}

// Lines arrive through a Tauri channel in order; the end of the run as its code.
export const createCoreBackendCommand = ({ invoke, Channel, newSessionId }: CoreBackendCommandOptions): BackendCommand =>
    commandOf(async (lines, exit) => {
        const session = newSessionId();
        await invoke("backend_start", { session, lines, exit });
        return { session, kill: () => invoke("backend_kill", { session }) };
    }, invoke, Channel);

export interface AttachedBackendCommandOptions {
    invoke: BackendInvoke;
    Channel: BackendChannelConstructor;
    sleep: (ms: number) => Promise<unknown>;
    // How often, and how far apart, a run that is not there yet is asked for again.
    attempts?: number;
    retryMs?: number;
}

// The settings window's (#1236): it joins the run the main window started (backend_attach) and
// reads every line of it. It does not start or stop a run; the tray can open it while the main
// window is still starting one, so a run that is not there yet is asked for again, for up to
// about 30 seconds.
export const createAttachedBackendCommand = ({ invoke, Channel, sleep, attempts = 120, retryMs = 250 }: AttachedBackendCommandOptions): BackendCommand =>
    commandOf(async (lines, exit) => {
        for (let attempt = 1; ; attempt++) {
            try {
                const session = await invoke<string>("backend_attach", { lines, exit });
                return { session, kill: async () => undefined };
            } catch (error) {
                if (error !== "backend_not_running" || attempt >= attempts) throw error;
                await sleep(retryMs);
            }
        }
    }, invoke, Channel);

type RunStarter = (lines: { onmessage: (message: string) => void }, exit: { onmessage: (message: number | null) => void })
    => Promise<{ session: string; kill: () => Promise<unknown> }>;

const commandOf = (startRun: RunStarter, invoke: BackendInvoke, Channel: BackendChannelConstructor): BackendCommand => {
    const own: ListenerLists<BackendCommandEvents> = {};
    const out: ListenerLists<BackendStreamEvents> = {};
    const err: ListenerLists<BackendStreamEvents> = {};
    const emit = <E, K extends keyof E>(list: ListenerLists<E>, event: K, value: E[K]) =>
        (list[event] ?? []).forEach(listener => { listener(value); });
    const command: BackendCommand = {
        on(event, listener) {
            register(own, event, listener);
            return command;
        },
        stdout: { on: (event, listener) => register(out, event, listener) },
        stderr: { on: (event, listener) => register(err, event, listener) },
        async spawn() {
            const lines = new Channel<string>();
            lines.onmessage = line => emit(out, "data", line);
            const exit = new Channel<number | null>();
            exit.onmessage = code => emit(own, "close", { code, signal: null });
            const { session, kill } = await startRun(lines, exit);
            return {
                pid: 0,
                // The core takes one request per call; the newline the sidecar needed is not sent.
                write: async (line: string) => {
                    await invoke("backend_write", { session, line: String(line).replace(/\r?\n$/, "") });
                    return true;
                },
                kill,
            };
        },
    };
    return command;
};

