import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("Two distinct UI agents: ContextReactiveUiAgent adapts to pidirector advisories/cuts/manual actions and preflight", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "picomposer-test-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const config = loadConfig({
    PICOMPOSER_RULES_FILE: path.join(tmpDir, "standing-rules.json"),
  });
  const { app } = buildApp(config);
  await app.ready();

  // 1. Verify the two distinct UI agents are exposed and neither is the broadcast director
  const agentsRes = await app.inject({
    method: "GET",
    url: "/api/v1/agents",
  });
  assert.equal(agentsRes.statusCode, 200);
  const agents = agentsRes.json().agents;
  assert.equal(agents.length, 2);
  assert.equal(agents[0].id, "context-reactive-agent");
  assert.equal(agents[0].isBroadcastDirector, false);
  assert.equal(agents[1].id, "prompted-creator-agent");
  assert.equal(agents[1].isBroadcastDirector, false);

  // 2. Initially in preflight phase -> screen-1 (copilot) and screen-3 (preflight) include Setup & Preflight flow panel
  const screen1PreflightRes = await app.inject({
    method: "GET",
    url: "/api/v1/screens/copilot",
  });
  assert.equal(screen1PreflightRes.statusCode, 200);
  const screen1Preflight = screen1PreflightRes.json().screen.spec;
  assert.equal(screen1Preflight.screenId, "screen-1");
  assert.equal(screen1Preflight.broadcastPhase, "preflight");
  assert.equal(screen1Preflight.divisions[0].slots[0].panels[0].id, "panel-preflight-flow");

  // 3. Transition pitube broadcast to LIVE and pidirector advises a shot -> hover + advisory panel appear on screen-1
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "pitube",
      data: {
        state: "live",
        selectedBroadcast: {
          id: "yt_live_1",
          title: "Pyhän miesten päivän messu",
          status: "live",
        },
      },
    },
  });

  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "advisory",
      data: {
        id: "adv_101",
        trigger: "cue:saarna",
        decision: {
          recommendedAction: "cut",
          cutToInput: 2,
          prepareCamera: { camera: 2, preset: "pulpit" },
          rationale: "Preacher stepped to pulpit",
        },
      },
    },
  });

  const afterAdvisoryRes = await app.inject({
    method: "GET",
    url: "/api/v1/screens/screen-1",
  });
  const afterAdvisorySpec = afterAdvisoryRes.json().screen.spec;
  assert.equal(afterAdvisorySpec.broadcastPhase, "live");
  assert.equal(afterAdvisorySpec.directorMode, "advisory");
  assert.equal(afterAdvisorySpec.hovers.length, 1);
  assert.equal(afterAdvisorySpec.hovers[0].id, "hover-advisory-adv_101");
  assert.equal(afterAdvisorySpec.hovers[0].tone, "advisory");
  assert.equal(afterAdvisorySpec.hovers[0].actions[0].action, "director.acceptAdvisory");

  // 4. Operator acts manually -> screen-1 pivots immediately to Manual Operator Control panel + Continue AI button
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "action",
      data: {
        actor: "booth-operator",
        action: "camera.move",
        params: { camera: 3 },
      },
    },
  });

  const afterManualRes = await app.inject({
    method: "GET",
    url: "/api/v1/screens/screen-1",
  });
  const afterManualSpec = afterManualRes.json().screen.spec;
  assert.equal(afterManualSpec.directorMode, "manual");
  assert.equal(afterManualSpec.hovers.length, 0);
  const leftPanel = afterManualSpec.divisions[0].slots[0].panels[0];
  assert.equal(leftPanel.id, "panel-manual-operator");
  assert.equal(leftPanel.tone, "manual");
  assert.equal(leftPanel.actions[0].action, "director.continue");

  await app.close();
});

test("PromptedUiCreatorAgent: compiles standing UI rules ('Add graphics buttons here during sermon'), persists to disk, and injects when section matches", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "picomposer-rules-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
  const rulesFile = path.join(tmpDir, "standing-rules.json");

  const config = loadConfig({
    PICOMPOSER_RULES_FILE: rulesFile,
  });
  const { app } = buildApp(config);
  await app.ready();

  // Set broadcast phase to live in intro section
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "pitube",
      data: { state: "live", title: "Messu" },
    },
  });
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "rundown",
      data: {
        title: "Messu",
        currentSection: "Johdanto",
        currentCueId: "alkuvirsi",
        currentCueTitle: "Alkuvirsi 332",
        placeInEvent: "1/18 Alkuvirsi",
      },
    },
  });

  // 1. Prompt the UI Creator Agent with a standing request: "Add graphics buttons here during sermon"
  const promptRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "Add graphics buttons here during sermon",
      targetScreenId: "screen-1",
      durability: "persistent",
    },
  });
  assert.equal(promptRes.statusCode, 200);
  const promptJson = promptRes.json();
  assert.equal(promptJson.intent, "standing_rule");
  assert.equal(promptJson.rule.trigger.section, "sermon");
  assert.equal(promptJson.rule.durability, "persistent");

  // Verify rule was persisted to disk
  const diskRules = JSON.parse(await fs.readFile(rulesFile, "utf8"));
  assert.equal(diskRules.length, 1);
  assert.equal(diskRules[0].trigger.section, "sermon");

  // While in "Johdanto" (not sermon), the standing rule is NOT active on screen-1
  assert.equal(promptJson.screen.activeStandingRuleIds.length, 0);

  // 2. Rundown advances to "Saarna" (sermon) with speaker "Pastori Matti"
  // -> ContextReactiveUiAgent automatically mounts the Lower-Third Graphics panel with speaker metadata!
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "rundown",
      data: {
        currentSection: "Sana",
        currentCueId: "saarna",
        currentCueTitle: "Saarna",
        assignedSpeaker: "Pastori Matti",
        placeInEvent: "6/18 Saarna",
      },
    },
  });

  const duringSermonRes = await app.inject({
    method: "GET",
    url: "/api/v1/screens/screen-1",
  });
  const sermonSpec = duringSermonRes.json().screen.spec;
  assert.equal(sermonSpec.activeStandingRuleIds.length, 1);
  const mountedRulePanel = sermonSpec.divisions[0].slots[0].panels[0];
  assert.equal(mountedRulePanel.tone, "standing-rule");
  assert.equal(mountedRulePanel.children[0].component, "graphics-lower-third-panel");
  assert.equal(mountedRulePanel.children[0].props.title, "Saarna");
  assert.equal(mountedRulePanel.children[0].props.subtitle, "Pastori Matti");

  // 3. Prompt the UI Creator Agent for a custom multi-screen operator layout on screen-2 (and an ad-hoc tablet screen)
  const workspacePromptRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "Give me Camera 2 PTZ controls and tally cues",
      targetScreenId: "screen-2",
    },
  });
  assert.equal(workspacePromptRes.statusCode, 200);
  const wsJson = workspacePromptRes.json();
  assert.equal(wsJson.intent, "screen_layout");
  assert.equal(wsJson.targetScreenId, "screen-2");
  assert.equal(wsJson.screen.divisions[0].slots.length, 2);

  await app.close();
});
