import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseScenario } from "../src/sim/scenario.js";
import { assertLocalTarget, runOffline } from "../src/sim/player.js";

test("parseScenario skips comments, sorts by time and rejects bad steps", () => {
  const steps = parseScenario('# c\n{"at":5,"event":"atem"}\n\n{"at":1,"prompt":"x"}');
  assert.deepEqual(steps.map((s) => s.at), [1, 5]);
  assert.throws(() => parseScenario('{"at":1}'), /line 1/);
  assert.throws(() => parseScenario("nope"), /invalid JSON/);
});

test("every sample scenario runs offline and writes snapshots", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sim-test-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  for (const name of ["normal-service", "operator-takes-over", "failures"]) {
    const steps = parseScenario(await fs.readFile(`scenarios/${name}.jsonl`, "utf8"));
    const out = path.join(tmp, name);
    const res = await runOffline(steps, out);
    assert.equal(res.steps, steps.length);
    const last = String(steps.length).padStart(2, "0");
    const html = await fs.readFile(path.join(out, `step-${last}-screen-1.html`), "utf8");
    assert.ok(html.includes("<html") || html.includes("<!doctype") || html.length > 200);
    await fs.access(path.join(out, "index.html"));
  }
});

test("live sim refuses non-local targets", () => {
  assert.throws(() => assertLocalTarget("http://192.168.1.78:3460"), /non-local/);
  assertLocalTarget("http://127.0.0.1:3460");
});
