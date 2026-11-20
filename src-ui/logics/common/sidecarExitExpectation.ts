// One request that is expected to end the backend (shutdown or an update).
export interface ExpectedExitToken {
    endpoint: string;
}

// The part of the sidecar session this module reads and changes.
export interface ExitExpectingSession {
    expectedExits: Map<string, Set<ExpectedExitToken>>;
}

export const isBackendUpdate = (endpoint: string) => ["/run/update_software", "/run/update_cuda_software"].includes(endpoint);

export const expectBackendExit = (session: ExitExpectingSession | null | undefined, endpoint: string): ExpectedExitToken | null => {
    if (!session || (endpoint !== "/run/shutdown" && !isBackendUpdate(endpoint))) return null;
    const token = { endpoint };
    let tokens = session.expectedExits.get(endpoint);
    if (!tokens) {
        tokens = new Set();
        session.expectedExits.set(endpoint, tokens);
    }
    tokens.add(token);
    return token;
};

export const undoExpectedExit = (session: ExitExpectingSession, token: ExpectedExitToken | null | undefined) => {
    if (!token) return;
    const tokens = session.expectedExits.get(token.endpoint);
    if (!tokens?.delete(token)) return;
    if (tokens.size === 0) session.expectedExits.delete(token.endpoint);
};

export const rejectExpectedExit = (session: ExitExpectingSession | null | undefined, endpoint: string) => {
    session?.expectedExits.delete(endpoint);
};
