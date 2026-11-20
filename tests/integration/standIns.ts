// What the app reaches outside itself, played on this PC: an OpenAI-compatible translation
// server, a speech.cpp server and the OSC receiver VRChat would be. Each keeps what reached it,
// so that a test can check what the core sent out.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createSocket } from "node:dgram";
import type { Socket } from "node:dgram";
import type { AddressInfo } from "node:net";

export interface Received {
    method: string;
    path: string;
    authorization: string | undefined;
    body: unknown;
}

abstract class HttpStandIn {
    readonly received: Received[] = [];
    private server: Server | null = null;
    url = "";

    protected abstract answer(request: Received, response: ServerResponse): void;

    async start() {
        this.server = createServer((request: IncomingMessage, response: ServerResponse) => {
            const chunks: Buffer[] = [];
            request.on("data", chunk => chunks.push(chunk));
            request.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let body: unknown = text;
                try { body = text ? JSON.parse(text) : null; } catch { /* kept as text */ }
                const seen = { method: request.method ?? "", path: request.url ?? "", authorization: request.headers.authorization, body };
                this.received.push(seen);
                this.answer(seen, response);
            });
        });
        await new Promise<void>(resolve => this.server?.listen(0, "127.0.0.1", resolve));
        this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
        return this;
    }

    async stop() {
        await new Promise(resolve => this.server ? this.server.close(resolve) : resolve(null));
    }

    protected json(response: ServerResponse, status: number, value: unknown) {
        const body = JSON.stringify(value);
        response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
        response.end(body);
    }
}

/** An OpenAI-compatible server, answered as native/translation/src/fake.rs answers: one model, and
 *  the translation it is given for every chat request. Requests without the key are refused. */
export class OpenAiCompatible extends HttpStandIn {
    private readonly key: string | null;
    private readonly translation: string;

    constructor(key: string | null, translation: string) {
        super();
        this.key = key;
        this.translation = translation;
    }

    /** The chat requests, each with the text it asked to translate. */
    translations() {
        return this.received.filter(seen => seen.path.endsWith("/chat/completions"));
    }

    protected answer(request: Received, response: ServerResponse) {
        if (this.key !== null && request.authorization !== `Bearer ${this.key}`) {
            return this.json(response, 401, { error: { message: "invalid key" } });
        }
        if (request.method === "GET" && request.path.endsWith("/models")) {
            return this.json(response, 200, { object: "list", data: [{ id: "stand-in-model", object: "model" }] });
        }
        if (request.method === "POST" && request.path.endsWith("/chat/completions")) {
            return this.json(response, 200, { choices: [{ index: 0, message: { role: "assistant", content: this.translation }, finish_reason: "stop" }] });
        }
        return this.json(response, 404, {});
    }
}

/** A speech.cpp server as native/tts/src/client.rs asks it: healthy, one synthesis model, and a
 *  short tone of 16-bit mono PCM for every speech request. */
export class SpeechServer extends HttpStandIn {
    speeches() {
        return this.received.filter(seen => seen.method === "POST" && seen.path === "/v1/audio/speech");
    }

    protected answer(request: Received, response: ServerResponse) {
        if (request.path === "/health") return this.json(response, 200, { status: "ok" });
        if (request.path === "/v1/models") {
            return this.json(response, 200, { data: [{ id: "stand-in-tts", speech: { task: "synthesis", options: [] } }] });
        }
        if (request.method === "POST" && request.path === "/v1/audio/speech") {
            const samples = 24_000 / 4;
            const pcm = Buffer.alloc(samples * 2);
            for (let i = 0; i < samples; i++) pcm.writeInt16LE(((i % 60) - 30) * 200, i * 2);
            response.writeHead(200, { "Content-Type": "audio/pcm", "X-Sample-Rate": "24000", "Content-Length": pcm.length });
            return response.end(pcm);
        }
        return this.json(response, 404, {});
    }
}

export interface OscMessage {
    address: string;
    args: (string | number | boolean)[];
}

/** The OSC receiver of VRChat, on a UDP port of this PC: the messages it was sent, read as OSC 1.0
 *  (address, type tags, then strings, 32-bit integers and floats, true and false). */
export class OscReceiver {
    readonly messages: OscMessage[] = [];
    private socket: Socket | null = null;
    port = 0;

    async start() {
        const socket = createSocket("udp4");
        this.socket = socket;
        socket.on("message", packet => {
            const message = readOsc(packet);
            if (message) this.messages.push(message);
        });
        await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
        this.port = socket.address().port;
        return this;
    }

    chatbox() {
        return this.messages.filter(message => message.address === "/chatbox/input");
    }

    async stop() {
        await new Promise(resolve => this.socket ? this.socket.close(() => resolve(null)) : resolve(null));
    }
}

function readOsc(packet: Buffer): OscMessage | null {
    let at = 0;
    const text = () => {
        const end = packet.indexOf(0, at);
        if (end < 0) throw new Error("unterminated OSC string");
        const value = packet.toString("utf8", at, end);
        at = (end + 4) & ~3;
        return value;
    };
    try {
        const address = text();
        if (!address.startsWith("/")) return null;
        const tags = text();
        const args: OscMessage["args"] = [];
        for (const tag of tags.slice(1)) {
            if (tag === "s") args.push(text());
            else if (tag === "i") { args.push(packet.readInt32BE(at)); at += 4; }
            else if (tag === "f") { args.push(packet.readFloatBE(at)); at += 4; }
            else if (tag === "T" || tag === "F") args.push(tag === "T");
        }
        return { address, args };
    } catch {
        return null;
    }
}
