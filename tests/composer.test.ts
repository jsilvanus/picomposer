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

test("Multi-screen named pages & numbered views (/gui/:name/:number), UI editing dialog, context chips, mouse context, conditionals, macros, charts, timers, and saved components", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "picomposer-gui-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const config = loadConfig({
    PICOMPOSER_RULES_FILE: path.join(tmpDir, "standing-rules.json"),
  });
  const { app } = buildApp(config);
  await app.ready();

  // 1. Default /gui and /gui/1/1 render permanent #btn-ui-edit, non-modal <dialog id="ai-prompt-dialog" popover="manual">, and 3 context chips
  const guiDefaultRes = await app.inject({ method: "GET", url: "/gui" });
  assert.equal(guiDefaultRes.statusCode, 200);
  const guiHtml = guiDefaultRes.body;
  assert.ok(guiHtml.includes('id="btn-ui-edit"'));
  assert.ok(guiHtml.includes('<dialog id="ai-prompt-dialog" popover="manual"'));
  assert.ok(guiHtml.includes('id="chip-broadcast-ctx"'));
  assert.ok(guiHtml.includes('id="chip-mouse-ctx"'));
  assert.ok(guiHtml.includes('id="chip-last-msg-ctx"'));

  // 2. Named pages with numbered views: e.g. John can have 3 views (/gui/john/1, /gui/john/2, /gui/john/3)
  for (const num of [1, 2, 3]) {
    const res = await app.inject({ method: "GET", url: `/gui/john/${num}` });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes(`data-page-name="john"`));
    assert.ok(res.body.includes(`data-view-number="${num}"`));
  }

  const pagesRes = await app.inject({ method: "GET", url: "/api/v1/pages" });
  assert.equal(pagesRes.statusCode, 200);
  const johnPage = pagesRes.json().pages.find((p: any) => p.pageName === "john");
  assert.ok(johnPage);
  assert.equal(johnPage.views.length, 3);
  assert.deepEqual(
    johnPage.views.map((v: any) => v.viewNumber),
    [1, 2, 3]
  );

  // 3. Draw a rectangle on /gui/john/1 and prompt "add here sound controls for wireless mics 1,2,5"
  await app.inject({
    method: "POST",
    url: "/api/v1/context/mouse",
    payload: {
      mode: "rectangle",
      pageName: "john",
      viewNumber: 1,
      rect: { x: 120, y: 80, width: 360, height: 220 },
    },
  });

  const micsRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "add here sound controls for wireless mics 1,2,5",
      pageName: "john",
      viewNumber: 1,
      useBroadcastContext: true,
      useMouseContext: true,
    },
  });
  assert.equal(micsRes.statusCode, 200);
  const micsJson = micsRes.json();
  assert.equal(micsJson.contextUsed.mouse, true);
  const john1Panels = micsJson.screen.divisions[0].slots[0].panels;
  const micPanel = john1Panels.find((p: any) => p.id === "panel-wireless-mics-1-2-5");
  assert.ok(micPanel);
  assert.deepEqual(micPanel.rectHint, { x: 120, y: 80, width: 360, height: 220 });
  assert.equal(micPanel.children[0].component, "wireless-mic-bank");
  assert.equal(micPanel.children[0].props.channels.length, 3);

  // 4. Save selected objects as a named UI component: "save these as sermon controls"
  await app.inject({
    method: "POST",
    url: "/api/v1/context/mouse",
    payload: {
      mode: "rectangle",
      pageName: "john",
      viewNumber: 1,
      rect: { x: 100, y: 50, width: 400, height: 300 },
      overlappingPanelIds: ["panel-wireless-mics-1-2-5"],
    },
  });

  const saveRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "save these as sermon controls",
      pageName: "john",
      viewNumber: 1,
      useMouseContext: true,
    },
  });
  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.json().intent, "save_component");
  assert.equal(saveRes.json().savedComponent.slug, "sermon-controls");

  // Mount the saved component onto /gui/john/2
  const insertRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "insert sermon controls",
      pageName: "john",
      viewNumber: 2,
    },
  });
  assert.equal(insertRes.statusCode, 200);
  const john2Panels = insertRes.json().screen.divisions[0].slots[0].panels;
  assert.ok(john2Panels.some((p: any) => p.savedComponentName === "sermon controls"));

  // 5. Highlight a component with mouse and say "Remove this"
  await app.inject({
    method: "POST",
    url: "/api/v1/context/mouse",
    payload: {
      mode: "component",
      pageName: "john",
      viewNumber: 1,
      componentId: "comp-fader-mic-5",
      panelId: "panel-wireless-mics-1-2-5",
    },
  });

  const removeRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "Remove this",
      pageName: "john",
      viewNumber: 1,
      useMouseContext: true,
    },
  });
  assert.equal(removeRes.statusCode, 200);
  assert.equal(removeRes.json().intent, "modify_selection");
  const updatedMicPanel = removeRes
    .json()
    .screen.divisions[0].slots[0].panels.find((p: any) => p.id === "panel-wireless-mics-1-2-5");
  assert.ok(!updatedMicPanel.children.some((c: any) => c.id === "comp-fader-mic-5"));

  // 6. Macro button + Timed visibility ("show for 5 minutes") + Conditional ("show only after sermon has passed")
  const macroRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt:
        "Add a button that turns off graphics and fades to black, show for 5 minutes, show only after sermon has passed",
      pageName: "john",
      viewNumber: 3,
    },
  });
  assert.equal(macroRes.statusCode, 200);
  const macroPanel = macroRes
    .json()
    .screen.divisions[0].slots[0].panels.find((p: any) => p.id.startsWith("panel-macro-"));
  assert.ok(macroPanel);
  assert.equal(macroPanel.showForSec, 300);
  assert.ok(macroPanel.expiresAt);
  assert.deepEqual(macroPanel.condition, { operator: "after", section: "sermon" });
  assert.equal(macroPanel.children[0].component, "macro-button");
  assert.equal(macroPanel.children[0].props.steps.length, 2);

  // Before sermon has passed, the conditional panel is rendered with `hidden data-conditional-hidden="true"` in /gui/john/3
  const beforeSermonPassedHtml = (await app.inject({ method: "GET", url: "/gui/john/3" })).body;
  assert.ok(beforeSermonPassedHtml.includes('hidden data-conditional-hidden="true"'));

  // Advance rundown to Saarna and then past Saarna to Ehtoollinen
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "rundown",
      data: { currentSection: "Saarna", currentCueId: "saarna", currentCueTitle: "Saarna" },
    },
  });
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "rundown",
      data: {
        currentSection: "Ehtoollinen",
        currentCueId: "ehtoollinen",
        currentCueTitle: "Ehtoollisrukous",
      },
    },
  });

  // Now that sermon has passed, the panel is visible (not hidden)!
  const afterSermonPassedHtml = (await app.inject({ method: "GET", url: "/gui/john/3" })).body;
  assert.ok(!afterSermonPassedHtml.includes('hidden data-conditional-hidden="true"'));

  // 7. Time-series chart + Rundown timer + Long scrolling document layout
  const chartRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "Add a time series chart of caption lag",
      pageName: "john",
      viewNumber: 3,
    },
  });
  assert.equal(chartRes.statusCode, 200);

  const timerRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "Add a rundown timer for section",
      pageName: "john",
      viewNumber: 3,
    },
  });
  assert.equal(timerRes.statusCode, 200);

  const docRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "Switch to long scrolling document layout",
      pageName: "john",
      viewNumber: 3,
    },
  });
  assert.equal(docRes.statusCode, 200);
  assert.equal(docRes.json().screen.layoutMode, "document");

  const docGuiHtml = (await app.inject({ method: "GET", url: "/gui/john/3" })).body;
  assert.ok(docGuiHtml.includes("piui-document-layout"));
  assert.ok(docGuiHtml.includes("gui-timeseries-chart"));
  assert.ok(docGuiHtml.includes("gui-timer-display"));

  await app.close();
});


test("Generative UI: Action targets on primitives, sent captions feed, UI-cues with phrase trigger, agent chat bar summoning, and direct command guard", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "picomposer-test-targets-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const config = loadConfig({
    PICOMPOSER_RULES_FILE: path.join(tmpDir, "standing-rules.json"),
  });
  const { app } = buildApp(config);
  await app.ready();

  // 1. Component catalog endpoint returns all atoms, molecules, and composer composites
  const catalogRes = await app.inject({
    method: "GET",
    url: "/api/v1/catalog/components",
  });
  assert.equal(catalogRes.statusCode, 200);
  const catalog = catalogRes.json().catalog;
  assert.ok(catalog.length >= 35);
  const kinds = catalog.map((c: any) => c.kind);
  assert.ok(kinds.includes("button"));
  assert.ok(kinds.includes("live-captions-feed"));
  assert.ok(kinds.includes("atem-bus-selector"));
  assert.ok(kinds.includes("agent-card"));
  assert.ok(kinds.includes("agent-control-toolbar"));
  assert.ok(kinds.includes("agent-chat-bubble"));

  // 2. Direct broadcast command guard: UI agent does NOT execute direct broadcast commands
  const directCmdRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "cut to cam 1",
      pageName: "operator",
      viewNumber: 1,
    },
  });
  assert.equal(directCmdRes.statusCode, 200);
  const directCmdBody = directCmdRes.json();
  assert.ok(directCmdBody.summary.includes("not execute live broadcast commands directly"));
  assert.ok(directCmdBody.summary.includes("summon an operational agent"));

  // 3. User asks for an agent -> operational chat prompt bar is summoned
  const summonAgentRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "summon agent chat prompt bar",
      pageName: "operator",
      viewNumber: 1,
    },
  });
  assert.equal(summonAgentRes.statusCode, 200);
  const summonBody = summonAgentRes.json();
  assert.ok(summonBody.summary.includes("Summoned operational agent chat prompt bar"));
  const allComps = summonBody.screen.divisions.flatMap((d: any) =>
    d.slots.flatMap((s: any) => s.panels.flatMap((p: any) => p.children))
  );
  const summonedKinds = allComps.map((c: any) => c.component);
  assert.ok(summonedKinds.includes("agent-card"));
  assert.ok(summonedKinds.includes("agent-control-toolbar"));
  assert.ok(summonedKinds.includes("agent-chat-bubble"));

  // 4. Primitives mapped to action targets: Button to issue "cam1 preset 4, cut after moved"
  const targetBtnRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: 'Button to issue "cam1 preset 4, cut after moved"',
      pageName: "operator",
      viewNumber: 1,
    },
  });
  assert.equal(targetBtnRes.statusCode, 200);
  const targetBtnBody = targetBtnRes.json();
  assert.ok(targetBtnBody.summary.includes("Cam 1 Preset 4 (Cut after moved)"));
  const btnPanel = targetBtnBody.screen.divisions[0].slots[0].panels.find(
    (p: any) => p.title && p.title.includes("Cam 1 Preset 4")
  );
  assert.ok(btnPanel);
  assert.equal(btnPanel.actions[0].action, "dispatch");
  assert.deepEqual(btnPanel.actions[0].targets, [
    { cam: { id: 1, preset: 4, cutAfterMoved: true } },
  ]);

  // 5. Sent captions feed: "show me sent captions while sermon is going on"
  const captionsRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "show me sent captions while sermon is going on",
      pageName: "operator",
      viewNumber: 1,
    },
  });
  assert.equal(captionsRes.statusCode, 200);
  const captionsBody = captionsRes.json();
  const captionsComp = captionsBody.screen.divisions[0].slots[0].panels
    .flatMap((p: any) => p.children)
    .find((c: any) => c.component === "live-captions-feed");
  assert.ok(captionsComp);
  assert.equal(captionsComp.props.sentOnly, true);
  assert.deepEqual(captionsComp.condition, { operator: "during", section: "sermon" });

  // 6. UI-Cues (phrase-triggered standing UI rules):
  // "show button that puts graveyard graphic on dsk if speaker speaks about resurrection"
  const uiCueRes = await app.inject({
    method: "POST",
    url: "/api/v1/prompt",
    payload: {
      prompt: "show button that puts graveyard graphic on dsk if speaker speaks about resurrection",
      pageName: "operator",
      viewNumber: 1,
    },
  });
  assert.equal(uiCueRes.statusCode, 200);
  const uiCueBody = uiCueRes.json();
  assert.equal(uiCueBody.intent, "standing_rule");
  assert.ok(uiCueBody.rule);
  assert.equal(uiCueBody.rule.trigger.phrase, "resurrection");
  assert.deepEqual(uiCueBody.rule.panel.actions[0].targets, [
    { dsk: { id: 1, graphic: "graveyard", onAir: true } },
  ]);

  // Transition broadcast to LIVE
  await app.inject({
    method: "POST",
    url: "/api/v1/ingest/event",
    payload: {
      type: "pitube",
      data: { state: "live" },
    },
  });

  // Check matching rules BEFORE phrase is heard -> 0 matching rules with resurrection phrase
  const rulesBeforeRes = await app.inject({
    method: "GET",
    url: "/api/v1/rules",
  });
  assert.equal(rulesBeforeRes.statusCode, 200);
  assert.equal(rulesBeforeRes.json().rules.length, 1);

  const screenBeforeTranscript = (
    await app.inject({ method: "GET", url: "/api/v1/screens/operator" })
  ).json().screen.spec;
  assert.equal(screenBeforeTranscript.activeStandingRuleIds.length, 0);

  // Now speaker says "resurrection" in sermon -> ingested via /api/v1/transcript
  const transcriptRes = await app.inject({
    method: "POST",
    url: "/api/v1/transcript",
    payload: {
      text: "Ja tänään me julistamme Kristuksen ylösnousemusta ja resurrection voimaa.",
    },
  });
  assert.equal(transcriptRes.statusCode, 200);
  assert.equal(transcriptRes.json().matchingRulesCount, 1);

  // Screen now has activeStandingRuleIds containing the resurrection UI cue
  const screenAfterTranscript = (
    await app.inject({ method: "GET", url: "/api/v1/screens/operator" })
  ).json().screen.spec;
  assert.equal(screenAfterTranscript.activeStandingRuleIds.length, 1);
  assert.equal(screenAfterTranscript.activeStandingRuleIds[0], uiCueBody.rule.id);

  // 7. Verify /api/v1/actions/dispatch endpoint executes hardware target
  const dispatchRes = await app.inject({
    method: "POST",
    url: "/api/v1/actions/dispatch",
    payload: {
      targets: [{ cam: { id: 1, preset: 4, cutAfterMoved: true } }],
      source: "gui_test",
    },
  });
  assert.equal(dispatchRes.statusCode, 200);
  assert.equal(dispatchRes.json().executedCount, 1);

  // 8. Rendered HTML in /gui/operator/1 includes action targets and piui component elements
  const guiHtml = (await app.inject({ method: "GET", url: "/gui/operator/1" })).body;
  assert.ok(guiHtml.includes('data-action-targets="[{&quot;cam&quot;:'));
  assert.ok(guiHtml.includes("Cam 1 Preset 4 (Cut after moved)"));

  await app.close();
});
