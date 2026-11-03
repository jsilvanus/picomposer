import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { GatewayStream, SseParser, mapGatewayEvent } from "../src/ingest/gateway-stream.js";

test("SseParser handles split chunks, comments and multi-line data", () => {
  const p = new SseParser();
  assert.deepEqual(p.push("event: atem\ndata: {\"a\":"), []);
  assert.deepEqual(p.push("1}\n\n: keep-alive\n\nevent: x\r\ndata: 1\r\n\r\n"), [
    { event: "atem", data: '{"a":1}' },
    { event: "x", data: "1" },
  ]);
});

test("mapGatewayEvent maps atem, rundown, pivoice, transcript", () => {
  assert.deepEqual(mapGatewayEvent("atem", { connected: true, programInput: 2 }), { type: "atem", data: { connected: true, programInput: 2 } });
  assert.equal(mapGatewayEvent("rundown", { loaded: false }), null);
  const r = mapGatewayEvent("rundown", { loaded: true, currentItem: { id: "i3", title: "Sermon", section: "Word" } });
  assert.equal(r?.data["currentSection"], "Word");
  assert.equal(mapGatewayEvent("pivoice", { classification: "speech" })?.data["voiceActive"], true);
  assert.equal(mapGatewayEvent("pivoice", { classification: "music" })?.data["voiceActive"], false);
  assert.equal(mapGatewayEvent("transcript", { text: "Hello", endedAt: 0 })?.data["timestamp"], "1970-01-01T00:00:00.000Z");
  assert.equal(mapGatewayEvent("camera", { id: "cam1" }), null);
});

test("GatewayStream feeds the ingestor and reconnects with the API key", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gw-stream-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const rules = path.join(tmp, "r.json");
  const { state, ingestor } = buildApp(loadConfig({ PICOMPOSER_RULES_FILE: rules }), { standingRulesFile: rules });

  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const enc = new TextEncoder();
  const fetchFn = (async (url: string, init: any) => {
    calls.push({ url, auth: init.headers.authorization });
    if (calls.length === 1) throw new Error("down");
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('event: atem\ndata: {"connected":true,"programInput":3,"previewInput":1}\n\n'));
        c.enqueue(enc.encode('event: transcript\ndata: {"text":"Rakas seurakunta","endedAt":1000}\n\n'));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

  const stream = new GatewayStream({ baseUrl: "http://gw:3100/", apiKey: "k", ingestor, fetchFn, minBackoffMs: 5, maxBackoffMs: 10 });
  stream.start();
  for (let i = 0; i < 100 && state.getContext().hardware.programInput !== 3; i++) await new Promise((r) => setTimeout(r, 20));
  stream.stop();
  assert.equal(state.getContext().hardware.programInput, 3);
  assert.ok(calls.length >= 2);
  assert.equal(calls[0]!.url, "http://gw:3100/api/v1/events?types=atem,rundown,pivoice,transcript&client=picomposer");
  assert.equal(calls[1]!.auth, "Bearer k");
});
