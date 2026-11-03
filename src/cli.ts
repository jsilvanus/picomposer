import fs from "node:fs/promises";
import { assertLocalTarget, runLive, runOffline } from "./sim/player.js";
import { parseScenario } from "./sim/scenario.js";

const baseUrl = (process.env["PICOMPOSER_URL"] ?? "http://127.0.0.1:3460").replace(/\/+$/, "");

async function request(path: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json;
}

async function run(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "status": {
      const data = await request("/api/v1/status");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "agents": {
      const data = await request("/api/v1/agents");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "screens": {
      const data = await request("/api/v1/screens");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "screen": {
      const screenId = args[0] ?? "screen-1";
      const data = await request(`/api/v1/screens/${encodeURIComponent(screenId)}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "prompt": {
      const screenFlagIdx = args.indexOf("--screen");
      let targetScreenId = "screen-1";
      const cleanArgs = [...args];
      if (screenFlagIdx >= 0 && cleanArgs[screenFlagIdx + 1]) {
        targetScreenId = cleanArgs[screenFlagIdx + 1]!;
        cleanArgs.splice(screenFlagIdx, 2);
      }
      const prompt = cleanArgs.join(" ").trim();
      if (!prompt) {
        console.error('Usage: picomposer prompt [--screen <screenId>] "<prompt>"');
        process.exit(1);
      }
      const data = await request("/api/v1/prompt", "POST", { prompt, targetScreenId });
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "rules": {
      const data = await request("/api/v1/rules");
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "sim": {
      const live = args.includes("--live");
      const outIdx = args.indexOf("--out");
      const outDir = outIdx >= 0 ? args[outIdx + 1]! : "sim-out";
      const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
      if (!file) {
        console.error("Usage: picomposer sim <scenario.jsonl> [--out <dir>] [--live]");
        process.exit(1);
      }
      const steps = parseScenario(await fs.readFile(file, "utf8"));
      if (live) {
        assertLocalTarget(baseUrl);
        await runLive(steps, baseUrl);
      } else {
        const res = await runOffline(steps, outDir);
        console.log(`${res.steps} steps -> ${res.outDir}/index.html`);
      }
      break;
    }

    default: {
      console.log(`picomposer CLI — Agentic Generative UI & Multi-Screen Composer (${baseUrl})

Commands:
  picomposer status                                  Show broadcast context, standing rules & screens
  picomposer agents                                  List the two UI agents (context-reactive vs prompted-creator)
  picomposer screens                                 List all screen slots (screen-1/copilot, screen-2/operator, screen-3/preflight)
  picomposer screen [screenId]                       Inspect typed JSON UiScreenSpec for a screen
  picomposer prompt [--screen <id>] "<prompt>"       Prompt the UI Creator Agent (e.g. "Add graphics buttons here during sermon")
  picomposer sim <file.jsonl> [--out dir] [--live]   Play a scenario: HTML snapshots per step (offline) or timed events to a local server
  picomposer rules                                   List persistent & broadcast-scoped standing UI rules`);
      break;
    }
  }
}

run().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
