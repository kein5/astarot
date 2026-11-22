import { isSidecarWarning } from "./sidecarDiagnostics.ts";
import type { BackendChild, BackendCommand, BackendExit } from "./backendCommand.ts";
import type { ExpectedExitToken } from "./sidecarExitExpectation.ts";

// "starting" until spawn gives a child, then "running"; "failed" when the start
// failed, "stopped" when a started backend ended.
export type SidecarPhase = "starting" | "running" | "failed" | "stopped";

export type SidecarTimer = ReturnType<typeof setInterval>;

export interface SidecarSession {
    phase: SidecarPhase;
    initialized: boolean;
    child: BackendChild | null;
    timer: SidecarTimer | null;
    expectedExits: Map<string, Set<ExpectedExitToken>>;
    retrying: boolean;
    // Settles when the spawn of this session (and the retirement of a late child) ends.
    completion?: Promise<void>;
    closed?: boolean;
    retirement?: Promise<boolean> | null;
    // Lines that came before spawn() gave the child. The core starts its start-up while
    // backend_start is still answering, so its first lines (even /run/initialization_complete)
    // can overtake that answer. They are handed on once requests can be written.
    early?: Array<{ readonly [key: string]: unknown }>;
}

// The fields of the shared UI store (store.ts) the session owner reads and writes.
export interface SidecarSessionStore {
    backend_session: SidecarSession | null;
    backend_subprocess: BackendChild | null;
    backend_stopped?: boolean;
}

// What a mounted controller does with the session's events.
export interface SidecarSessionHandlers {
    receiveRoutes(message: unknown): void;
    backendStopped(): void;
    feedWatchdog(): void;
    beginStartup(): void;
    setStartupState(phase: SidecarPhase, detail?: unknown): void;
    started(isCurrent: () => boolean): void;
    unexpectedExit(exit: Partial<BackendExit>): void;
    stderr(line: string): void;
}

export type SidecarHandlersGetter = () => SidecarSessionHandlers;

export interface SidecarSessionOwnerOptions {
    store: SidecarSessionStore;
    createCommand: () => BackendCommand;
    setInterval: (callback: () => void, ms: number) => SidecarTimer;
    clearInterval: (timer: SidecarTimer) => void;
}

export interface SidecarSessionOwner {
    attach(getHandlers: SidecarHandlersGetter): () => void;
    retry(): Promise<boolean>;
}

// Kept on the shared UI store, not a component ref. Mounts attach to this owner;
// only a deliberate retry of a failed start can replace its session.
export const createSidecarSessionOwner = ({ store, createCommand, setInterval, clearInterval }: SidecarSessionOwnerOptions): SidecarSessionOwner => {
    const clients = new Set<SidecarHandlersGetter>();
    let lastClient: SidecarHandlersGetter | undefined;
    const handlers = () => (Array.from(clients).at(-1) ?? lastClient)?.();
    const isCurrent = (session: SidecarSession) => store.backend_session === session;
    const isLive = (session: SidecarSession) => isCurrent(session) && ["starting", "running"].includes(session.phase);
    const stopFeeding = (session: SidecarSession) => {
        if (session.timer !== null) clearInterval(session.timer);
        session.timer = null;
    };
    const startFeeding = (session: SidecarSession) => {
        if (!isLive(session) || !session.child || !clients.size || session.timer !== null) return;
        session.timer = setInterval(() => {
            if (isLive(session) && clients.size) handlers()?.feedWatchdog();
        }, 20000);
    };
    const retireChild = async (session: SidecarSession) => {
        const child = session.child;
        if (!child || session.closed) return true;
        if (!session.retirement) {
            // The child checked just above; a session's child is never cleared once set.
            session.retirement = Promise.resolve().then(() => child.kill()).then(() => true, error => {
                console.error("Could not stop failed sidecar attempt", error);
                return false;
            });
        }
        return await session.retirement;
    };
    const finish = (session: SidecarSession, phase: SidecarPhase, detail?: unknown) => {
        if (!isLive(session)) return false;
        session.phase = phase;
        session.expectedExits.clear();
        stopFeeding(session);
        store.backend_subprocess = null;
        store.backend_stopped = true;
        handlers()?.backendStopped();
        // The failure detail is what the startup failure dialog explains.
        handlers()?.setStartupState(phase, detail);
        return true;
    };
    const fail = (session: SidecarSession, error: unknown) => {
        if (!finish(session, "failed", error ?? null)) return;
        console.error("Sidecar startup failed", error);
        // If spawn is still pending, its completion retires the late child.
        if (session.child) void retireChild(session);
    };
    const start = () => {
        const session: SidecarSession = { phase: "starting", initialized: false, child: null, timer: null, expectedExits: new Map(), retrying: false };
        store.backend_session = session;
        store.backend_subprocess = null;
        store.backend_stopped = false;
        handlers()?.beginStartup();
        handlers()?.setStartupState("starting");
        session.completion = Promise.resolve().then(async () => {
            try {
                const command = createCommand();
                const deliver = (message: { readonly [key: string]: unknown }) => {
                    try {
                        handlers()?.receiveRoutes(message);
                    } catch (error) {
                        console.log(error, message);
                    }
                };
                // The shell plugin also reports stdout/stderr read errors here,
                // which do not stop the child. Only fail a start that has no child.
                command.on("error", error => {
                    if (session.phase === "starting" && !session.child) fail(session, error);
                    else if (isCurrent(session)) console.error("sidecar command error", error);
                });
                command.on("close", ({ code, signal }: Partial<BackendExit> = {}) => {
                    if (!isCurrent(session)) return;
                    session.closed = true;
                    const expected = session.expectedExits.size > 0;
                    if (!session.initialized && !expected) {
                        fail(session, { code, signal });
                        return;
                    }
                    if (finish(session, "stopped") && !expected) handlers()?.unexpectedExit({ code, signal });
                });
                command.stdout.on("data", line => {
                    if (!isLive(session)) return;
                    // The shell plugin uses line mode; Windows CRLF can deliver
                    // an empty line. Escaped newlines inside JSON remain intact.
                    if (typeof line === "string" && line.trim() === "") return;
                    let message: { readonly [key: string]: unknown };
                    try {
                        // Not checked here: a JSON null throws below and is logged like invalid JSON.
                        message = JSON.parse(line) as { readonly [key: string]: unknown };
                        if (message.status === 200 && message.endpoint === "/run/initialization_complete") session.initialized = true;
                    } catch (error) {
                        console.log(error, line);
                        return;
                    }
                    // A reply to a line may send requests; until the child is known they could
                    // not be written and would read as "engine unavailable".
                    if (!session.child) {
                        session.early ??= [];
                        session.early.push(message);
                    } else deliver(message);
                });
                command.stderr.on("data", line => {
                    if (!isLive(session)) return;
                    if (isSidecarWarning(line)) console.warn("stderr (warning, ignored)", line);
                    else handlers()?.stderr(line);
                });
                const child = await command.spawn();
                session.child = child;
                const early = session.early ?? [];
                session.early = undefined;
                if (!isLive(session)) {
                    await retireChild(session);
                    return;
                }
                store.backend_subprocess = child;
                session.phase = "running";
                handlers()?.setStartupState("running");
                startFeeding(session);
                if (clients.size) handlers()?.started(() => isLive(session) && clients.size > 0);
                // In the order they came; a line may end the session, and then the rest is dropped.
                for (const message of early) {
                    if (!isLive(session)) break;
                    deliver(message);
                }
            } catch (error) {
                fail(session, error);
            }
        });
        return session;
    };
    const retry = async () => {
        const session = store.backend_session;
        if (session?.phase !== "failed" || session.retrying || !clients.size) return false;
        session.retrying = true;
        handlers()?.setStartupState("starting");
        // Do not spawn a replacement while an old spawn or kill is unresolved.
        await session.completion;
        const retired = await retireChild(session);
        if (!isCurrent(session)) return false;
        if (!retired && !session.closed) {
            session.retirement = null;
            session.retrying = false;
            handlers()?.setStartupState("failed");
            return false;
        }
        if (!clients.size) {
            session.retrying = false;
            handlers()?.setStartupState("failed");
            return false;
        }
        await start().completion;
        return true;
    };
    const attach = (getHandlers: SidecarHandlersGetter) => {
        clients.add(getHandlers);
        lastClient = getHandlers;
        const session = store.backend_session ?? start();
        getHandlers().setStartupState(session.retrying ? "starting" : session.phase);
        startFeeding(session);
        return () => {
            clients.delete(getHandlers);
            // attach() made sure a session exists, and nothing clears it afterwards.
            const session = store.backend_session;
            if (!clients.size && session) stopFeeding(session);
        };
    };
    return { attach, retry };
};
