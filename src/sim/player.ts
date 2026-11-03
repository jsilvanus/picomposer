import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { renderGuiPageHtml } from "../gui/render-gui.js";
import type { ScenarioStep } from "./scenario.js";

const SNAPSHOT_SCREENS = ["screen-1", "screen-2", "screen-3"];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Offline: no network. The LLM call always fails, so the prompt agent uses its deterministic compiler. */
const offlineFetch: typeof fetch = async () => {
  throw new Error("picomposer sim: network disabled");
};

export interface SimResult {
  outDir: string;
  steps: number;
}

/** Run a scenario in-process and write one HTML snapshot per screen after every step, plus index.html. */
export async function runOffline(steps: ScenarioStep[], outDir: string): Promise<SimResult> {
  await fs.mkdir(outDir, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "picomposer-sim-"));
  try {
    const config = loadConfig({ PICOMPOSER_RULES_FILE: path.join(tmp, "standing-rules.json") });
    const { app, state, ingestor, creatorAgent } = buildApp(config, {
      fetchFn: offlineFetch,
      standingRulesFile: path.join(tmp, "standing-rules.json"),
    });
    await app.ready();

    const rows: string[] = [];
    const snapshot = async (n: number, title: string) => {
      const links: string[] = [];
      for (const id of SNAPSHOT_SCREENS) {
        const spec = state.getScreen(id)?.spec;
        if (!spec) continue;
        const file = `step-${String(n).padStart(2, "0")}-${id}.html`;
        const html = renderGuiPageHtml({
          spec,
          context: state.getContext(),
          mouseContext: state.getMouseContext(),
          lastMessageContext: state.getLastMessageContext(),
          pages: state.listPages(),
          savedComponentNames: state.savedComponentsStore.list().map((c) => c.name),
        });
        await fs.writeFile(path.join(outDir, file), html);
        links.push(`<a href="${file}">${id}</a>`);
      }
      rows.push(`<tr><td>${n}</td><td>${escapeHtml(title)}</td><td>${links.join(" · ")}</td></tr>`);
    };

    await snapshot(0, "startup");
    let n = 0;
    for (const step of steps) {
      n++;
      if (step.event) {
        ingestor.handleEvent(step.event, step.data ?? {});
      } else if (step.prompt) {
        await creatorAgent.handlePrompt({ prompt: step.prompt, targetScreenId: step.screen ?? "screen-2" });
      }
      await snapshot(n, step.label ?? (step.event ? `event: ${step.event}` : `prompt: ${step.prompt}`));
    }
    await app.close();

    const index = `<!doctype html><meta charset="utf-8"><title>picomposer sim</title>
<style>body{font:14px system-ui;margin:2rem}td,th{padding:.3rem .8rem;text-align:left}</style>
<h1>picomposer simulation</h1><table><tr><th>#</th><th>Step</th><th>Screens</th></tr>${rows.join("")}</table>`;
    await fs.writeFile(path.join(outDir, "index.html"), index);
    return { outDir, steps: steps.length };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Live: replay the scenario with real timing against a running picomposer (watch /gui/... in a browser). */
export async function runLive(steps: ScenarioStep[], baseUrl: string, log: (m: string) => void = console.log): Promise<void> {
  const start = Date.now();
  for (const step of steps) {
    const wait = step.at - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const [url, body] = step.event
      ? ["/api/v1/ingest/event", { type: step.event, data: step.data ?? {} }]
      : ["/api/v1/prompt", { prompt: step.prompt, targetScreenId: step.screen ?? "screen-2" }];
    const res = await fetch(`${baseUrl}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    log(`t=${step.at}ms ${step.label ?? step.event ?? step.prompt} -> HTTP ${res.status}`);
  }
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** Live mode only talks to this machine: a sim must never feed a real Pi. */
export function assertLocalTarget(baseUrl: string): void {
  const host = new URL(baseUrl).hostname;
  if (!LOCAL.test(host)) {
    throw new Error(`refusing live sim against non-local host ${host}`);
  }
}
