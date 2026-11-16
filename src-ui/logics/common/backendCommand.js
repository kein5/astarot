// The backend the UI starts: the Rust core run inside the app (#285). It is given to
// sidecarSession.js in the shape of the shell plugin's Command interface that the Python sidecar
// used (on("error"), on("close"), stdout/stderr on("data"), spawn() giving a child with write()
// and kill()), so the session rules stayed the same when the sidecar went.

const register = (list, event, listener) => {
    (list[event] ??= []).push(listener);
};

// Lines arrive through a Tauri channel in order; the end of the run as its code.
export const createCoreBackendCommand = ({ invoke, Channel, newSessionId }) => {
    const own = {};
    const out = {};
    const err = {};
    const emit = (list, event, value) => (list[event] ?? []).forEach(listener => listener(value));
    const command = {
        on(event, listener) {
            register(own, event, listener);
            return command;
        },
        stdout: { on: (event, listener) => register(out, event, listener) },
        stderr: { on: (event, listener) => register(err, event, listener) },
        async spawn() {
            const session = newSessionId();
            const lines = new Channel();
            lines.onmessage = line => emit(out, "data", line);
            const exit = new Channel();
            exit.onmessage = code => emit(own, "close", { code, signal: null });
            await invoke("backend_start", { session, lines, exit });
            return {
                pid: 0,
                // The core takes one request per call; the newline the sidecar needed is not sent.
                write: async line => {
                    await invoke("backend_write", { session, line: String(line).replace(/\r?\n$/, "") });
                    return true;
                },
                kill: () => invoke("backend_kill", { session }),
            };
        },
    };
    return command;
};
