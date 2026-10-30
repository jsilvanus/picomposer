import type { ComposerEventBroker } from "../events.js";
import type { StandingRulesStore } from "../rules/standing-rules-store.js";
import type {
  StandingUiRule,
  UiDivisionNode,
  UiHoverNode,
  UiPanelNode,
  UiScreenSpec,
} from "../schema/ui-schema.js";
import type { BroadcastContextState, ComposerState } from "../state/composer-state.js";

export interface ContextReactiveAgentOptions {
  state: ComposerState;
  rulesStore: StandingRulesStore;
  eventBroker?: ComposerEventBroker | undefined;
}

/**
 * Agent 1: Context-Reactive UI Agent ("ui-context-composer")
 *
 * Automatically composes and updates operator UI screens based on:
 * - pidirector advising a shot (advisory mode -> prominent Accept/Dismiss hover & preview controls)
 * - pidirector directing (autonomous mode -> active shot rationale, prepared preview, preempt/steering)
 * - Operator manual action / preemption (manual mode -> manual camera/switcher controls + Continue AI)
 * - Broadcast phase (composer-driven Setup & Preflight checklist when idle/ready; post-broadcast archive when complete)
 * - Active Standing UI Rules (e.g. mounting lower-third graphics buttons during the sermon)
 */
export class ContextReactiveUiAgent {
  private readonly state: ComposerState;
  private readonly rulesStore: StandingRulesStore;
  private readonly eventBroker?: ComposerEventBroker | undefined;

  constructor(options: ContextReactiveAgentOptions) {
    this.state = options.state;
    this.rulesStore = options.rulesStore;
    this.eventBroker = options.eventBroker;
  }

  /**
   * Re-evaluates all context-managed screens (and re-injects standing rules on all screens).
   */
  composeAll(reason = "context_change"): UiScreenSpec[] {
    const updated: UiScreenSpec[] = [];
    for (const slot of this.state.listScreens()) {
      if (slot.managedBy === "context-reactive-agent") {
        updated.push(this.composeScreen(slot.screenId, reason));
      } else if (slot.spec) {
        // Re-apply standing rules to prompted screens as well so standing rules targeting screen-2 work seamlessly
        updated.push(this.refreshStandingRulesOnScreen(slot.screenId, slot.spec, reason));
      } else {
        updated.push(this.composeDefaultOperatorWorkspace(slot.screenId, reason));
      }
    }
    return updated;
  }

  composeScreen(idOrAlias: string, reason = "context_change"): UiScreenSpec {
    const slot = this.state.ensureScreen(idOrAlias);
    const ctx = this.state.getContext();
    const matchingRules = this.rulesStore.getMatchingRules(ctx, slot.screenId);

    const spec =
      slot.role === "preflight"
        ? this.buildPreflightScreenSpec(slot.screenId, slot.screenName, ctx, matchingRules, reason)
        : this.buildCopilotScreenSpec(slot.screenId, slot.screenName, ctx, matchingRules, reason);

    this.state.setScreenSpec(slot.screenId, spec);
    this.eventBroker?.emit({
      type: "agent-turn",
      data: {
        agentId: "context-reactive-agent",
        trigger: reason,
        targetScreenId: slot.screenId,
        summary: `Composed ${slot.screenId} (${spec.broadcastPhase}/${spec.directorMode}, ${matchingRules.length} standing rules)`,
        time: spec.updatedAt,
      },
    });
    return spec;
  }

  private buildContextSummary(ctx: BroadcastContextState): UiScreenSpec["contextSummary"] {
    return {
      broadcastId: ctx.director.broadcastId ?? ctx.pitube.broadcastId,
      broadcastTitle: ctx.pitube.title ?? ctx.rundown.title,
      placeInEvent: ctx.rundown.placeInEvent,
      activeSection: ctx.rundown.currentSection,
      activeSubsection: ctx.rundown.currentSubsection ?? ctx.rundown.currentCueTitle,
      timingSummary: ctx.rundown.timingSummary,
      nextItemTitle: ctx.rundown.nextItem?.title ?? null,
      programInput: ctx.hardware.programInput,
      previewInput: ctx.hardware.previewInput,
    };
  }

  private buildPreflightPanel(ctx: BroadcastContextState): UiPanelNode {
    const checks = [
      {
        id: "check_pitube",
        label: "YouTube Broadcast (pitube)",
        ok: Boolean(ctx.pitube.title && ctx.pitube.state !== "offline"),
        detail: ctx.pitube.title
          ? `${ctx.pitube.title} (${ctx.pitube.state})`
          : "No broadcast selected — will fallback to date-only naming",
      },
      {
        id: "check_rundown",
        label: "Service Rundown (pirundown)",
        ok: ctx.rundown.loaded,
        detail: ctx.rundown.title
          ? `${ctx.rundown.title} (${ctx.rundown.placeInEvent ?? "Ready"})`
          : "No rundown loaded yet",
      },
      {
        id: "check_atem_cam",
        label: "ATEM Switcher & FreeD Cameras",
        ok: ctx.hardware.atemConnected && ctx.hardware.camerasConnected,
        detail: `PGM ${ctx.hardware.programInput} | PVW ${ctx.hardware.previewInput}`,
      },
      {
        id: "check_voice",
        label: "Sanctuary Audio & Captions (pivoice)",
        ok: ctx.hardware.voiceActive,
        detail: ctx.hardware.voiceActive ? "Capture active" : "Capture stopped",
      },
    ];

    return {
      type: "panel",
      id: "panel-preflight-flow",
      title: "Broadcast Setup & Preflight Flow",
      subtitle: "Verify broadcast metadata, rundown cues, and AV hardware before going live",
      icon: "fact_check",
      tone: "preflight",
      zone: "top",
      sourceLabel: "Composer Preflight",
      collapsible: false,
      collapsed: false,
      pinned: true,
      actions: [
        {
          id: "act-pitube-select-auto",
          label: "Auto-Select Broadcast",
          action: "pitube.select",
          params: { broadcastId: "auto" },
          variant: "secondary",
          icon: "smart_display",
        },
        {
          id: "act-pitube-start",
          label: "Go Live (pitube)",
          action: "pitube.start",
          params: {},
          variant: "primary",
          icon: "play_arrow",
        },
      ],
      children: [
        {
          type: "component",
          id: "comp-preflight-checklist",
          component: "preflight-checklist-card",
          props: {
            phase: ctx.phase,
            pitubeState: ctx.pitube.state,
            broadcastTitle: ctx.pitube.title,
            checks,
          },
          actions: [
            {
              id: "act-director-start-advisory",
              label: "Start AI Co-Pilot (Advisory)",
              action: "director.mode",
              params: { mode: "advisory" },
              variant: "secondary",
            },
            {
              id: "act-director-start-auto",
              label: "Start AI Autonomous",
              action: "director.mode",
              params: { mode: "autonomous" },
              variant: "primary",
            },
          ],
        },
      ],
    };
  }

  private buildCopilotScreenSpec(
    screenId: string,
    screenName: string,
    ctx: BroadcastContextState,
    matchingRules: StandingUiRule[],
    reason: string
  ): UiScreenSpec {
    const now = new Date().toISOString();
    const topPanels: UiPanelNode[] = [];
    const mainLeftPanels: UiPanelNode[] = [];
    const mainRightPanels: UiPanelNode[] = [];
    const bottomPanels: UiPanelNode[] = [];
    const hovers: UiHoverNode[] = [];

    // 1. If in preflight phase, include the composer-driven preflight flow at the top
    if (ctx.phase === "preflight") {
      topPanels.push(this.buildPreflightPanel(ctx));
    }

    // 2. React to pidirector state: Advisory vs Autonomous Directing vs Operator Manual Override
    const adv = ctx.director.pendingAdvisory;
    if (ctx.director.mode === "advisory" && adv) {
      const targetCam = adv.prepareCamera?.camera ?? adv.cutToInput ?? ctx.hardware.previewInput;
      const targetPreset = adv.prepareCamera?.preset ?? 1;

      hovers.push({
        type: "hover",
        id: `hover-advisory-${adv.id}`,
        title: `Director Advises: ${adv.recommendedAction.toUpperCase()} → Cam ${targetCam}`,
        subtitle: adv.rationale,
        icon: "smart_toy",
        placement: "top-right",
        tone: "advisory",
        badgeLabel: "CO-PILOT ADVISORY",
        dismissible: true,
        pinned: true,
        actions: [
          {
            id: `act-accept-${adv.id}`,
            label: `Accept Cut → Cam ${targetCam}`,
            action: "director.acceptAdvisory",
            params: { advisoryId: adv.id },
            variant: "primary",
            icon: "check",
          },
          {
            id: `act-dismiss-${adv.id}`,
            label: "Dismiss",
            action: "director.dismissAdvisory",
            params: { advisoryId: adv.id },
            variant: "ghost",
          },
        ],
        children: [
          {
            type: "component",
            id: `comp-adv-card-${adv.id}`,
            component: "director-advisory-card",
            props: {
              advisoryId: adv.id,
              trigger: adv.trigger,
              recommendedAction: adv.recommendedAction,
              cutToInput: adv.cutToInput ?? null,
              prepareCamera: adv.prepareCamera ?? null,
              graphics: adv.graphics ?? null,
              rationale: adv.rationale,
            },
            actions: [],
          },
        ],
      });

      mainLeftPanels.push({
        type: "panel",
        id: "panel-advisory-controls",
        title: `Advised Target: Camera ${targetCam} Controls`,
        subtitle: `Pre-positioned for ${adv.trigger} (${adv.rationale})`,
        icon: "videocam",
        tone: "advisory",
        zone: "main",
        sourceLabel: "Director Advisory",
        collapsible: false,
        collapsed: false,
        pinned: false,
        actions: [
          {
            id: `act-panel-accept-${adv.id}`,
            label: "Accept Advisory",
            action: "director.acceptAdvisory",
            params: { advisoryId: adv.id },
            variant: "primary",
          },
        ],
        children: [
          {
            type: "component",
            id: "comp-advised-ptz-presets",
            component: "ptz-preset-card",
            props: {
              camera: targetCam,
              activePreset: targetPreset,
            },
            actions: [
              {
                id: "act-recall-advised-preset",
                label: `Recall Preset ${targetPreset}`,
                action: "camera.preset",
                params: { camera: targetCam, preset: targetPreset },
                variant: "secondary",
              },
            ],
          },
          {
            type: "component",
            id: "comp-advised-atem-bus",
            component: "atem-bus-selector",
            props: {
              programInput: ctx.hardware.programInput,
              previewInput: Number(targetCam) || ctx.hardware.previewInput,
            },
            actions: [
              {
                id: "act-manual-cut",
                label: "CUT Now",
                action: "atem.cut",
                params: {},
                variant: "atem-pgm",
              },
            ],
          },
        ],
      });
    } else if (ctx.director.mode === "autonomous") {
      const lastDec = ctx.director.lastDecision;
      mainLeftPanels.push({
        type: "panel",
        id: "panel-autonomous-director",
        title: "Autonomous AI Director Active",
        subtitle: lastDec
          ? `Last action: ${lastDec.recommendedAction.toUpperCase()} (${lastDec.rationale})`
          : `Monitoring cues — PGM ${ctx.hardware.programInput} / PVW ${ctx.hardware.previewInput}`,
        icon: "auto_awesome",
        tone: "directing",
        zone: "main",
        sourceLabel: "AI Directing",
        collapsible: false,
        collapsed: false,
        pinned: true,
        actions: [
          {
            id: "act-preempt-manual",
            label: "Take Manual Control",
            action: "director.preempt",
            params: { reason: "Operator manual takeover from UI" },
            variant: "danger",
            icon: "stop",
          },
          {
            id: "act-switch-advisory",
            label: "Switch to Advisory",
            action: "director.mode",
            params: { mode: "advisory" },
            variant: "secondary",
          },
        ],
        children: [
          {
            type: "component",
            id: "comp-active-shot",
            component: "director-active-shot-card",
            props: {
              programInput: ctx.hardware.programInput,
              previewInput: ctx.hardware.previewInput,
              dwellSec: ctx.hardware.dwellSec,
              lastDecision: lastDec,
              placeInEvent: ctx.rundown.placeInEvent,
              timingSummary: ctx.rundown.timingSummary,
              nextItem: ctx.rundown.nextItem,
            },
            actions: [],
          },
        ],
      });
    } else {
      // Manual mode / operator override
      const opAct = ctx.director.lastOperatorAction;
      const focusCam = opAct?.targetCamera ?? opAct?.targetInput ?? ctx.hardware.programInput;
      mainLeftPanels.push({
        type: "panel",
        id: "panel-manual-operator",
        title: `Manual Operator Control (Cam ${focusCam})`,
        subtitle: opAct
          ? `Triggered by ${opAct.actor}: ${opAct.action}`
          : `AI Director paused — resumable to ${ctx.director.lastActiveMode.toUpperCase()}`,
        icon: "pan_tool",
        tone: "manual",
        zone: "main",
        sourceLabel: "Operator Active",
        collapsible: false,
        collapsed: false,
        pinned: true,
        actions: [
          {
            id: "act-continue-ai",
            label: `Continue AI (${ctx.director.lastActiveMode})`,
            action: "director.continue",
            params: { mode: ctx.director.lastActiveMode },
            variant: "primary",
            icon: "play_arrow",
          },
        ],
        children: [
          {
            type: "component",
            id: "comp-manual-override",
            component: "manual-override-card",
            props: {
              focusCamera: focusCam,
              programInput: ctx.hardware.programInput,
              previewInput: ctx.hardware.previewInput,
              resumableMode: ctx.director.lastActiveMode,
            },
            actions: [],
          },
          {
            type: "component",
            id: "comp-manual-atem-bus",
            component: "atem-bus-selector",
            props: {
              programInput: ctx.hardware.programInput,
              previewInput: ctx.hardware.previewInput,
            },
            actions: [
              {
                id: "act-atem-cut",
                label: "CUT",
                action: "atem.cut",
                params: {},
                variant: "atem-pgm",
              },
            ],
          },
          {
            type: "component",
            id: "comp-manual-ptz",
            component: "ptz-pad",
            props: {
              camera: focusCam,
            },
            actions: [],
          },
        ],
      });
    }

    // 3. Right column: Rundown situational awareness + Steering notes + Decision log
    mainRightPanels.push({
      type: "panel",
      id: "panel-rundown-context",
      title: ctx.rundown.placeInEvent ?? ctx.rundown.currentCueTitle ?? "Service Rundown",
      subtitle: ctx.rundown.timingSummary ?? "Waiting for rundown cue",
      icon: "schedule",
      tone: ctx.rundown.overtime ? "advisory" : "default",
      zone: "sidebar",
      sourceLabel: ctx.rundown.overtime ? "OVERTIME" : "Rundown",
      collapsible: false,
      collapsed: false,
      pinned: false,
      actions: [
        {
          id: "act-rundown-next",
          label: "Next Cue",
          action: "rundown.next",
          params: {},
          variant: "secondary",
        },
      ],
      children: [
        {
          type: "component",
          id: "comp-rundown-active-item",
          component: "rundown-item-card",
          props: {
            placeInEvent: ctx.rundown.placeInEvent,
            section: ctx.rundown.currentSection,
            subsection: ctx.rundown.currentSubsection,
            speaker: ctx.rundown.assignedSpeaker,
            expectedDurationSec: ctx.rundown.expectedDurationSec,
            timerSec: ctx.rundown.timerSec,
            overtime: ctx.rundown.overtime,
            timingSummary: ctx.rundown.timingSummary,
            nextItem: ctx.rundown.nextItem,
          },
          actions: [],
        },
      ],
    });

    mainRightPanels.push({
      type: "panel",
      id: "panel-steering-and-logs",
      title: "Steering Notes & Decision Log",
      subtitle: `${ctx.director.steeringNotes.filter((n) => n.enabled && !n.expired).length} active steering notes`,
      icon: "tune",
      tone: "default",
      zone: "sidebar",
      collapsible: true,
      collapsed: false,
      pinned: false,
      actions: [],
      children: [
        {
          type: "component",
          id: "comp-steering-notes",
          component: "steering-notes-list",
          props: {
            notes: ctx.director.steeringNotes,
          },
          actions: [],
        },
        {
          type: "component",
          id: "comp-decision-logs",
          component: "decision-log-list",
          props: {
            logs: ctx.director.recentLogs,
          },
          actions: [],
        },
      ],
    });

    // 4. Inject matching Standing UI Rules (e.g. "Add graphics buttons here during sermon")
    this.injectStandingRules(
      matchingRules,
      ctx,
      { topPanels, mainLeftPanels, mainRightPanels, bottomPanels, hovers }
    );

    const divisions: UiDivisionNode[] = [];
    if (topPanels.length > 0) {
      divisions.push({
        type: "division",
        id: "div-top",
        direction: "vertical",
        columns: 1,
        gap: "md",
        divided: false,
        slots: [{ id: "slot-top", panels: topPanels }],
      });
    }

    divisions.push({
      type: "division",
      id: "div-main",
      direction: "grid",
      columns: 2,
      gap: "md",
      divided: false,
      slots: [
        { id: "slot-main-left", label: "Director & Live Controls", colSpan: 1, panels: mainLeftPanels },
        { id: "slot-main-right", label: "Rundown & Context", colSpan: 1, panels: mainRightPanels },
      ],
    });

    if (bottomPanels.length > 0) {
      divisions.push({
        type: "division",
        id: "div-bottom",
        direction: "vertical",
        columns: 1,
        gap: "md",
        divided: false,
        slots: [{ id: "slot-bottom", panels: bottomPanels }],
      });
    }

    return {
      screenId,
      screenName,
      role: "copilot",
      generatedBy: "context-reactive-agent",
      updatedAt: now,
      reason,
      broadcastPhase: ctx.phase,
      directorMode: ctx.director.mode,
      contextSummary: this.buildContextSummary(ctx),
      activeStandingRuleIds: matchingRules.map((r) => r.id),
      divisions,
      hovers,
    };
  }

  private buildPreflightScreenSpec(
    screenId: string,
    screenName: string,
    ctx: BroadcastContextState,
    matchingRules: StandingUiRule[],
    reason: string
  ): UiScreenSpec {
    const now = new Date().toISOString();
    const topPanels: UiPanelNode[] = [this.buildPreflightPanel(ctx)];
    const mainLeftPanels: UiPanelNode[] = [
      {
        type: "panel",
        id: "panel-pitube-stream",
        title: "Broadcast Lifecycle (pitube)",
        subtitle: ctx.pitube.title ?? "Date-only broadcast naming fallback ready",
        icon: "live_tv",
        tone: "default",
        zone: "main",
        collapsible: false,
        collapsed: false,
        pinned: false,
        actions: [],
        children: [
          {
            type: "component",
            id: "comp-stream-status",
            component: "stream-status-card",
            props: {
              state: ctx.pitube.state,
              broadcastId: ctx.pitube.broadcastId,
              broadcastTitle: ctx.pitube.title,
              health: ctx.pitube.streamHealth ?? "unknown",
            },
            actions: [],
          },
        ],
      },
    ];
    const mainRightPanels: UiPanelNode[] = [
      {
        type: "panel",
        id: "panel-preflight-rundown",
        title: "Service Rundown & Timing",
        subtitle: ctx.rundown.timingSummary ?? "Rundown overview",
        icon: "view_list",
        tone: "default",
        zone: "sidebar",
        collapsible: false,
        collapsed: false,
        pinned: false,
        actions: [],
        children: [
          {
            type: "component",
            id: "comp-preflight-rundown-item",
            component: "rundown-item-card",
            props: {
              placeInEvent: ctx.rundown.placeInEvent,
              section: ctx.rundown.currentSection,
              speaker: ctx.rundown.assignedSpeaker,
              timingSummary: ctx.rundown.timingSummary,
              nextItem: ctx.rundown.nextItem,
            },
            actions: [],
          },
        ],
      },
    ];
    const bottomPanels: UiPanelNode[] = [];
    const hovers: UiHoverNode[] = [];

    this.injectStandingRules(
      matchingRules,
      ctx,
      { topPanels, mainLeftPanels, mainRightPanels, bottomPanels, hovers }
    );

    return {
      screenId,
      screenName,
      role: "preflight",
      generatedBy: "context-reactive-agent",
      updatedAt: now,
      reason,
      broadcastPhase: ctx.phase,
      directorMode: ctx.director.mode,
      contextSummary: this.buildContextSummary(ctx),
      activeStandingRuleIds: matchingRules.map((r) => r.id),
      divisions: [
        {
          type: "division",
          id: "div-preflight-top",
          direction: "vertical",
          columns: 1,
          gap: "md",
          divided: false,
          slots: [{ id: "slot-preflight-top", panels: topPanels }],
        },
        {
          type: "division",
          id: "div-preflight-main",
          direction: "grid",
          columns: 2,
          gap: "md",
          divided: false,
          slots: [
            { id: "slot-preflight-left", colSpan: 1, panels: mainLeftPanels },
            { id: "slot-preflight-right", colSpan: 1, panels: mainRightPanels },
          ],
        },
      ],
      hovers,
    };
  }

  composeDefaultOperatorWorkspace(screenId: string, reason = "initial"): UiScreenSpec {
    const slot = this.state.ensureScreen(screenId);
    const ctx = this.state.getContext();
    const matchingRules = this.rulesStore.getMatchingRules(ctx, slot.screenId);
    const topPanels: UiPanelNode[] = [];
    const mainLeftPanels: UiPanelNode[] = [
      {
        type: "panel",
        id: "panel-operator-switcher",
        title: "Switcher & Camera Control",
        subtitle: "Prompt the UI Creator Agent to customize this screen or add standing rules",
        icon: "videocam",
        tone: "default",
        zone: "main",
        collapsible: false,
        collapsed: false,
        pinned: false,
        actions: [],
        children: [
          {
            type: "component",
            id: "comp-op-atem",
            component: "atem-bus-selector",
            props: {
              programInput: ctx.hardware.programInput,
              previewInput: ctx.hardware.previewInput,
            },
            actions: [],
          },
        ],
      },
    ];
    const mainRightPanels: UiPanelNode[] = [];
    const bottomPanels: UiPanelNode[] = [];
    const hovers: UiHoverNode[] = [];

    this.injectStandingRules(
      matchingRules,
      ctx,
      { topPanels, mainLeftPanels, mainRightPanels, bottomPanels, hovers }
    );

    const spec: UiScreenSpec = {
      screenId: slot.screenId,
      screenName: slot.screenName,
      role: slot.role,
      generatedBy: "prompted-creator-agent",
      updatedAt: new Date().toISOString(),
      reason,
      broadcastPhase: ctx.phase,
      directorMode: ctx.director.mode,
      contextSummary: this.buildContextSummary(ctx),
      activeStandingRuleIds: matchingRules.map((r) => r.id),
      divisions: [
        {
          type: "division",
          id: "div-op-main",
          direction: "grid",
          columns: mainRightPanels.length > 0 ? 2 : 1,
          gap: "md",
          divided: false,
          slots: [
            { id: "slot-op-left", colSpan: 1, panels: [...topPanels, ...mainLeftPanels, ...bottomPanels] },
            ...(mainRightPanels.length > 0
              ? [{ id: "slot-op-right", colSpan: 1 as const, panels: mainRightPanels }]
              : []),
          ],
        },
      ],
      hovers,
    };

    this.state.setScreenSpec(slot.screenId, spec);
    return spec;
  }

  private refreshStandingRulesOnScreen(
    screenId: string,
    existing: UiScreenSpec,
    reason: string
  ): UiScreenSpec {
    const ctx = this.state.getContext();
    const matchingRules = this.rulesStore.getMatchingRules(ctx, screenId);

    // Strip previously injected standing-rule panels/hovers and re-inject currently matching ones
    const cleanedDivisions: UiDivisionNode[] = existing.divisions.map((div) => ({
      ...div,
      slots: div.slots.map((slot) => ({
        ...slot,
        panels: slot.panels.filter((p) => !p.ruleId),
      })),
    }));
    const cleanedHovers = existing.hovers.filter((h) => !h.ruleId);

    const topPanels: UiPanelNode[] = [];
    const mainLeftPanels: UiPanelNode[] = [];
    const mainRightPanels: UiPanelNode[] = [];
    const bottomPanels: UiPanelNode[] = [];
    const hovers: UiHoverNode[] = [...cleanedHovers];

    this.injectStandingRules(
      matchingRules,
      ctx,
      { topPanels, mainLeftPanels, mainRightPanels, bottomPanels, hovers }
    );

    const injectedPanels = [...topPanels, ...mainLeftPanels, ...mainRightPanels, ...bottomPanels];
    if (injectedPanels.length > 0) {
      if (cleanedDivisions.length === 0) {
        cleanedDivisions.push({
          type: "division",
          id: "div-standing-rules",
          direction: "vertical",
          columns: 1,
          gap: "md",
          divided: false,
          slots: [{ id: "slot-standing-rules", panels: injectedPanels }],
        });
      } else {
        cleanedDivisions[0]!.slots[0]?.panels.unshift(...injectedPanels);
      }
    }

    const updated: UiScreenSpec = {
      ...existing,
      updatedAt: new Date().toISOString(),
      reason,
      broadcastPhase: ctx.phase,
      directorMode: ctx.director.mode,
      contextSummary: this.buildContextSummary(ctx),
      activeStandingRuleIds: matchingRules.map((r) => r.id),
      divisions: cleanedDivisions,
      hovers,
    };
    this.state.setScreenSpec(screenId, updated);
    return updated;
  }

  private injectStandingRules(
    matchingRules: StandingUiRule[],
    ctx: BroadcastContextState,
    buckets: {
      topPanels: UiPanelNode[];
      mainLeftPanels: UiPanelNode[];
      mainRightPanels: UiPanelNode[];
      bottomPanels: UiPanelNode[];
      hovers: UiHoverNode[];
    }
  ): void {
    for (const rule of matchingRules) {
      if (rule.container === "hover" && rule.hover) {
        buckets.hovers.push({
          ...structuredClone(rule.hover),
          ruleId: rule.id,
          badgeLabel: rule.hover.badgeLabel ?? `Rule: ${rule.name}`,
        });
        continue;
      }

      if (rule.panel) {
        const panel: UiPanelNode = {
          ...structuredClone(rule.panel),
          ruleId: rule.id,
          tone: "standing-rule",
          sourceLabel: rule.panel.sourceLabel ?? `Standing Rule: ${rule.name}`,
        };

        // Enrich lower-third graphics panels with live speaker/cue context from pirundown
        for (const child of panel.children) {
          if (child.component === "graphics-lower-third-panel") {
            child.props = {
              ...child.props,
              title: (child.props["title"] as string | undefined) ?? ctx.rundown.currentCueTitle ?? "Saarna",
              subtitle:
                (child.props["subtitle"] as string | undefined) ?? ctx.rundown.assignedSpeaker ?? "",
            };
          }
        }
        for (const act of panel.actions) {
          if (act.action === "graphics.lowerThird" && act.params["showLowerThird"] === true) {
            act.params = {
              ...act.params,
              title: (act.params["title"] as string | undefined) ?? ctx.rundown.currentCueTitle ?? "Saarna",
              subtitle:
                (act.params["subtitle"] as string | undefined) ?? ctx.rundown.assignedSpeaker ?? "",
            };
          }
        }

        if (rule.targetZone === "top") {
          buckets.topPanels.push(panel);
        } else if (rule.targetZone === "sidebar") {
          buckets.mainRightPanels.unshift(panel);
        } else if (rule.targetZone === "bottom") {
          buckets.bottomPanels.push(panel);
        } else {
          buckets.mainLeftPanels.unshift(panel);
        }
      }
    }
  }
}
