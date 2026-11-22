// The i18next translate function, as far as this module uses it.
export type Translate = (key: string) => string;

// Display only. The backend validates both saved values and save requests.
const isPrivateLanHost = (host: string) => {
    // A multicast DNS name of the LAN (name.local); the backend allows plain HTTP to it too.
    if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+local\.?$/i.test(host)) return true;
    if (host.startsWith("[")) {
        // URL canonicalizes IPv6; unique-local fc00::/7 and link-local fe80::/10.
        return /^\[(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(host);
    }
    const octets = host.split(".").map(Number);
    if (octets.length !== 4 || !octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return false;
    const [first, second] = octets;
    return first === 10 || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168) || (first === 169 && second === 254);
};

const isPlainLanHttp = (url: string) => {
    try {
        const endpoint = new URL(url);
        return endpoint.protocol === "http:" && isPrivateLanHost(endpoint.hostname);
    } catch { return false; /* Incomplete drafts are validated when saved. */ }
};

// A URL row's words in two parts: what the row is, with the save notice, and the warning about
// plain HTTP on the LAN (null when it does not apply). A page that keeps descriptions out of
// sight (#614) makes the first the label's hint and keeps the warning in sight.
export const endpointNotices = (url: string, description: string | null | undefined, t: Translate) => ({
    description: [description, t("network_privacy.save_notice")].filter(Boolean).join(" "),
    warning: isPlainLanHttp(url) ? t("network_privacy.http_warning") : null,
});

export const endpointDescription = (url: string, description: string | null | undefined, t: Translate) => {
    const { description: text, warning } = endpointNotices(url, description, t);
    return [text, warning].filter(Boolean).join(" ");
};

export const isNetworkDisconnected = (value: unknown) => value === false;
