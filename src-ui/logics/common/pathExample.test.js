import assert from "node:assert/strict";
import { test } from "node:test";
import { pathExample } from "./pathExample.js";

test("a path placeholder is written the way the OS writes paths", () => {
    const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0";
    const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    assert.equal(pathExample("model.gguf", windows), "C:\\models\\model.gguf");
    assert.equal(pathExample("model.gguf", linux), "/home/user/models/model.gguf");
    assert.equal(pathExample("vad.gguf", ""), "/home/user/models/vad.gguf");
});
