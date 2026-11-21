// What the app's backend_start, backend_write and backend_kill commands do (src-tauri/src/
// backend_host.rs), over a WebSocket to the core's host (native/browser-core-bridge). The lines
// reach the app through the Tauri channels it gave, as Tauri delivers them: in order, by index.
// A test may hold the lines for a while and then let them all go in order, to see a page as it is
// before the core's answers come, on a fast machine as on a slow one (#912).

export interface TauriChannel {
    id: number;
}

declare global {
    interface Window {
        __TAURI_INTERNALS__: { runCallback(id: number, data: unknown): void };
        __holdCoreLines?: () => void;
        __releaseCoreLines?: () => void;
    }
}

export interface CoreConnection {
    handles(command: string): boolean;
    invoke(command: string, payload: Record<string, unknown>): Promise<null>;
}

type Frame = { op: "started" } | { op: "line"; line: string } | { op: "exit"; code: number };

const COMMANDS = new Set(["backend_start", "backend_write", "backend_kill"]);

export function coreConnection(url: string): CoreConnection {
    let socket: Promise<WebSocket> | null = null;
    let lines: TauriChannel | null = null;
    let exit: TauriChannel | null = null;
    let lineIndex = 0;
    let started: (() => void) | null = null;
    // The lines a test holds, while it does.
    let held: string[] | null = null;
    const deliver = (channel: TauriChannel, index: number, message: unknown) =>
        window.__TAURI_INTERNALS__.runCallback(channel.id, { index, message });
    const deliverLine = (line: string) => { if (lines) deliver(lines, lineIndex++, line); };
    window.__holdCoreLines = () => { held ??= []; };
    window.__releaseCoreLines = () => {
        const waiting = held ?? [];
        held = null;
        for (const line of waiting) deliverLine(line);
    };
    const open = () => new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error(`The core's host does not answer at ${url}`));
        ws.onmessage = event => {
            const frame: Frame = JSON.parse(String(event.data));
            if (frame.op === "started") {
                started?.();
                started = null;
            } else if (frame.op === "line" && held) {
                held.push(frame.line);
            } else if (frame.op === "line") {
                deliverLine(frame.line);
            } else if (frame.op === "exit" && exit) {
                deliver(exit, 0, frame.code);
            }
        };
    });
    const send = async (frame: Record<string, unknown>) => (await (socket ??= open())).send(JSON.stringify(frame));
    return {
        handles: command => COMMANDS.has(command),
        async invoke(command, payload) {
            if (command === "backend_start") {
                lines = payload.lines as TauriChannel;
                exit = payload.exit as TauriChannel;
                lineIndex = 0;
                const ready = new Promise<void>(resolve => { started = resolve; });
                await send({ op: "start" });
                await ready;
            } else if (command === "backend_write") {
                await send({ op: "write", line: payload.line });
            } else {
                await send({ op: "kill" });
            }
            return null;
        },
    };
}
