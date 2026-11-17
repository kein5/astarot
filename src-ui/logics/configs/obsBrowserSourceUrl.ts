// The URLs the settings page copies for OBS and for other apps. Where the servers listen
// decides the scheme: on this PC (127.0.0.0/8) plain http and ws; beyond it only https and
// wss, because the backend refuses a LAN host without a certificate (models/websocket/tls.py).
const LOOPBACK = /^(127(\.\d{1,3}){3}|localhost|::1|\[::1\])$/i;
export const isLoopbackHost = (host: unknown): boolean => LOOPBACK.test(String(host ?? ""));

const urlHostOf = (host: unknown): string => {
    const address = !host || host === "0.0.0.0" ? "127.0.0.1" : String(host);
    return address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
};

// `url` goes to the clipboard; `shown` is what the screen may show.
export type CopiedUrl = { url: string; shown: string };

// Only the clipboard gets the real token; the screen (screenshots, streams) shows dots.
const withToken = (base: string, token: string | null | undefined, separator: string): CopiedUrl => ({
    url: token ? `${base}${separator}token=${encodeURIComponent(token)}` : base,
    shown: token ? `${base}${separator}token=••••••••` : base,
});

export const buildObsBrowserSourceUrl = (host: unknown, port: number | string, token: string | null | undefined): CopiedUrl => {
    const urlHost = urlHostOf(host);
    return withToken(`${isLoopbackHost(urlHost) ? "http" : "https"}://${urlHost}:${port}/obs`, token, "?");
};

export const buildWebsocketUrl = (host: unknown, port: number | string, token: string | null | undefined): CopiedUrl => {
    const urlHost = urlHostOf(host);
    return withToken(`${isLoopbackHost(urlHost) ? "ws" : "wss"}://${urlHost}:${port}`, token, "/?");
};
