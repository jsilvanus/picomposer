import type { ComposerEventBroker } from "../events.js";
import type { StandingRulesStore } from "../rules/standing-rules-store.js";
import {
  StandingUiRuleCreateSchema,
  UiScreenSpecSchema,
  type MouseSelectionContext,
  type RundownActionItem,
  type SavedUiComponent,
  type StandingUiRule,
  type TimeSeriesMetric,
  type UiComponentNode,
  type UiMacroStep,
  type UiPanelNode,
  type UiScreenSpec,
  type UiVisibilityCondition,
} from "../schema/ui-schema.js";
import type { BroadcastContextState, ComposerState } from "../state/composer-state.js";
import type { ContextReactiveUiAgent } from "./context-reactive-agent.js";

export interface PromptedCreatorAgentOptions {
  state: ComposerState;
  rulesStore: StandingRulesStore;
  reactiveAgent: ContextReactiveUiAgent;
  ollamaUrl: string;
  model: string;
  timeoutMs?: number | undefined;
  fetchFn?: typeof fetch | undefined;
  eventBroker?: ComposerEventBroker | undefined;
}

export interface PromptExecutionResult {
  ok: true;
  agentId: "prompted-creator-agent";
  intent: "standing_rule" | "screen_layout" | "save_component" | "modify_selection";
  source: "ollama" | "deterministic-compiler";
  targetScreenId: string;
  summary: string;
  rule?: StandingUiRule | undefined;
  savedComponent?: SavedUiComponent | undefined;
  screen: UiScreenSpec;
  contextUsed: {
    broadcast: boolean;
    mouse: boolean;
    lastMessage: boolean;
  };
}

/**
 * Helper to extract visibility conditions from natural language prompts,
 * e.g. "show only after sermon has passed", "before communion", "during sermon".
 */
export function parseVisibilityConditionFromPrompt(promptText: string): UiVisibilityCondition | undefined {
  const lower = promptText.toLowerCase();
  let section: string | undefined;
  if (lower.includes("sermon") || lower.includes("saarna")) section = "sermon";
  else if (lower.includes("communion") || lower.includes("ehtoollinen")) section = "communion";
  else if (lower.includes("prayer") || lower.includes("rukous") || lower.includes("intercession")) section = "intercession";
  else if (lower.includes("hymn") || lower.includes("virsi") || lower.includes("intro")) section = "intro";

  if (/\b(?:after|once)\b.*\b(?:passed|ended|finished|done|over|sermon|saarna|communion|prayer|intro)/i.test(promptText) || /\bafter\s+(?:the\s+)?(?:sermon|saarna|communion|prayer|intro)\b/i.test(promptText)) {
    return {
      operator: "after",
      section: section ?? "sermon",
    };
  }
  if (/\bbefore\s+(?:the\s+)?(?:sermon|saarna|communion|prayer|intro)\b/i.test(promptText)) {
    return {
      operator: "before",
      section: section ?? "sermon",
    };
  }
  if (
    /\b(?:only\s+)?during\s+(?:the\s+)?(?:sermon|saarna|communion|prayer|intro)\b/i.test(promptText) ||
    /\bwhile\s+(?:the\s+)?(?:sermon|saarna|communion|prayer|intro)\b/i.test(promptText) ||
    /\b(?:while|during)\b.*\b(?:sermon|saarna|communion|prayer|intro)\b.*\b(?:going on|active|live)\b/i.test(promptText)
  ) {
    return {
      operator: "during",
      section: section ?? "sermon",
    };
  }
  return undefined;
}

/**
 * Helper to extract timed duration ("show for 5 minutes", "for 30 seconds") from a prompt.
 */
export function parseTimedVisibilitySec(promptText: string): { showForSec?: number; expiresAt?: string } {
  const m = /\b(?:show\s+)?for\s+(\d+)\s*(min(?:ute)?s?|sec(?:ond)?s?|m|s)\b/i.exec(promptText);
  if (!m) return {};
  const amount = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(amount) || amount <= 0) return {};
  const unit = m[2]!.toLowerCase();
  const sec = unit.startsWith("m") ? amount * 60 : amount;
  return {
    showForSec: sec,
    expiresAt: new Date(Date.now() + sec * 1000).toISOString(),
  };
}

/**
 * Detects if a prompt is an imperative live broadcast execution command (e.g. "cut to cam 1")
 * rather than a UI-authoring instruction. The UI agent does NOT execute broadcast actions directly.
 */
export function isDirectBroadcastCommand(promptText: string): boolean {
  const t = promptText.trim().toLowerCase();
  const hasUiIntent =
    /\b(add|create|show|mount|button|panel|card|widget|strip|controls?|macro|cue|timer|chart|view|layout|save|preset\s*card|toolbar)\b/i.test(
      t
    );
  if (hasUiIntent) return false;

  return (
    /^(?:cut|switch|take)\s+(?:to\s+)?(?:cam(?:era)?\s*\d+|input\s*\d+|pgm|pvw)\b/i.test(t) ||
    /^(?:fade\s+to\s+black|ftb)\b/i.test(t) ||
    /^(?:mute|unmute)\s+(?:all|audio|mics?|sanctuary)\b/i.test(t) ||
    /^(?:start|stop)\s+(?:stream|broadcast|recording)\b/i.test(t) ||
    /^(?:privacy\s+blur|blur\s+cam(?:era)?)\b/i.test(t)
  );
}

/**
 * Extracts action targets (cameras, presets with cutAfterMoved, ATEM, DSK graphics, audio)
 * from natural language UI requests (e.g. "cam1 preset 4, cut after moved", "graveyard graphic on dsk").
 */
export function parseActionTargetsFromPrompt(promptText: string): { label: string; targets: RundownActionItem[] } | null {
  const targets: RundownActionItem[] = [];

  // cam preset: e.g. "cam1 preset 4, cut after moved", "camera 2 preset pulpit"
  const camPreset = /\bcam(?:era)?\s*(\d+)\s+preset\s*(\d+|[a-zA-Z0-9_-]+)/i.exec(promptText);
  if (camPreset) {
    const camId = Number.parseInt(camPreset[1]!, 10);
    const rawPreset = camPreset[2]!;
    const preset = Number.isNaN(Number(rawPreset)) ? rawPreset : Number(rawPreset);
    const cutAfterMoved = /\bcut\s+after\s+moved\b/i.test(promptText);
    targets.push({
      cam: {
        id: camId,
        preset,
        ...(cutAfterMoved ? { cutAfterMoved: true } : {}),
      },
    });
  }

  // privacy blur: e.g. "privacy blur on camera 1", "privacy blur cam 2"
  const privacyMatch = /\bprivacy\s+blur\s+(?:on\s+)?cam(?:era)?\s*(\d+)\b/i.exec(promptText);
  if (privacyMatch) {
    const camId = Number.parseInt(privacyMatch[1]!, 10);
    targets.push({
      cam: {
        id: camId,
        privacyBlur: true,
      },
    });
  }

  // graphic on dsk: e.g. "graveyard graphic on dsk", "put cross graphic on dsk"
  const dskMatch = /(?:put\s+)?([a-zA-Z0-9_-]+)\s+graphic\s+(?:on\s+)?dsk\b/i.exec(promptText);
  if (dskMatch) {
    const graphic = dskMatch[1]!;
    targets.push({
      dsk: {
        id: 1,
        graphic,
        onAir: true,
      },
    });
  }

  // atem cut / switch: e.g. "cut to cam 2", "cut to input 3"
  const cutMatch = /\bcut\s+(?:to\s+)?(?:cam(?:era)?|input)\s*(\d+)\b/i.exec(promptText);
  if (cutMatch && !camPreset) {
    const input = Number.parseInt(cutMatch[1]!, 10);
    targets.push({
      atem: {
        cut: input,
      },
    });
  }

  // mute audio: e.g. "mute mic 2", "mute all mics"
  const muteMatch = /\bmute\s+(?:mic\s*(\d+)|all\s+mics?|sanctuary)\b/i.exec(promptText);
  if (muteMatch) {
    const ch = muteMatch[1] ? Number.parseInt(muteMatch[1], 10) : undefined;
    if (ch) {
      targets.push({ audio: { channel: ch, mute: true } });
    } else {
      targets.push({ audio: { muteAll: true } });
    }
  }

  if (targets.length === 0) return null;

  let label = "Dispatch Action";
  if (camPreset) {
    const cut = /\bcut\s+after\s+moved\b/i.test(promptText) ? " (Cut after moved)" : "";
    label = `Cam ${camPreset[1]} Preset ${camPreset[2]}${cut}`;
  } else if (privacyMatch) {
    label = `Privacy Blur Cam ${privacyMatch[1]}`;
  } else if (dskMatch) {
    label = `${dskMatch[1]} Graphic on DSK`;
  } else if (cutMatch) {
    label = `Cut to Cam ${cutMatch[1]}`;
  } else if (muteMatch) {
    label = muteMatch[1] ? `Mute Mic ${muteMatch[1]}` : "Mute Sanctuary Mics";
  }

  return { label, targets };
}

/**
 * Agent 2: Prompted UI Creator Agent ("ui-prompt-creator")
 *
 * Explicitly NOT the broadcast director (never switches cameras or issues shot advisories).
 * Knows the full state of the broadcast, mouse selection context, last message context,
 * and the @piecosystem/piui component & layout catalog.
 */
export class PromptedUiCreatorAgent {
  private readonly state: ComposerState;
  private readonly rulesStore: StandingRulesStore;
  private readonly reactiveAgent: ContextReactiveUiAgent;
  private readonly ollamaUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly eventBroker?: ComposerEventBroker | undefined;

  constructor(options: PromptedCreatorAgentOptions) {
    this.state = options.state;
    this.rulesStore = options.rulesStore;
    this.reactiveAgent = options.reactiveAgent;
    this.ollamaUrl = options.ollamaUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.eventBroker = options.eventBroker;
  }

  async handlePrompt(input: {
    prompt: string;
    targetScreenId?: string | undefined;
    pageName?: string | undefined;
    viewNumber?: number | undefined;
    durability?: "persistent" | "broadcast" | undefined;
    useBroadcastContext?: boolean | undefined;
    useMouseContext?: boolean | undefined;
    useLastMessageContext?: boolean | undefined;
    mouseContextOverride?: MouseSelectionContext | undefined;
  }): Promise<PromptExecutionResult> {
    const promptText = input.prompt.trim();
    const resolvedTarget =
      input.pageName !== undefined || input.viewNumber !== undefined
        ? this.state.ensurePageView(input.pageName, input.viewNumber).screenId
        : this.state.resolveScreenId(input.targetScreenId ?? "screen-1");

    const useBroadcast = input.useBroadcastContext ?? true;
    const rawMouse = input.mouseContextOverride ?? this.state.getMouseContext();
    const useMouse = (input.useMouseContext ?? true) && rawMouse.mode !== "none";
    const lastMsg = this.state.getLastMessageContext();
    const useLastMsg = Boolean(input.useLastMessageContext && lastMsg);

    const ctx = this.state.getContext();
    const contextUsed = {
      broadcast: useBroadcast,
      mouse: useMouse,
      lastMessage: useLastMsg,
    };

    // 1. Check deterministic mouse/component/macro/chart/timer/save commands first if they are specific
    const specialResult = this.trySpecialCommandCompile(
      promptText,
      resolvedTarget,
      input.durability ?? "persistent",
      ctx,
      useMouse ? rawMouse : null,
      useLastMsg ? lastMsg : null,
      contextUsed
    );
    if (specialResult) {
      this.recordTurnAndLastMessage(resolvedTarget, promptText, specialResult);
      return specialResult;
    }

    // 2. Try Ollama structured JSON compilation
    const llmResult = await this.tryOllamaCompile(
      promptText,
      resolvedTarget,
      input.durability,
      useBroadcast ? ctx : null,
      useMouse ? rawMouse : null,
      useLastMsg ? lastMsg : null,
      contextUsed
    );
    if (llmResult) {
      this.recordTurnAndLastMessage(resolvedTarget, promptText, llmResult);
      return llmResult;
    }

    // 3. Fallback to deterministic compiler
    const compiled = this.compileDeterministically(
      promptText,
      resolvedTarget,
      input.durability ?? "persistent",
      ctx,
      useMouse ? rawMouse : null,
      useLastMsg ? lastMsg : null,
      contextUsed
    );
    this.recordTurnAndLastMessage(resolvedTarget, promptText, compiled);
    return compiled;
  }

  private recordTurnAndLastMessage(
    targetScreenId: string,
    prompt: string,
    result: PromptExecutionResult
  ): void {
    const slot = this.state.ensureScreen(targetScreenId);
    this.state.setLastMessageContext({
      prompt,
      responseSummary: result.summary,
      targetPage: slot.pageName,
      targetView: slot.viewNumber,
      targetScreenId: slot.screenId,
      intent: result.intent,
      timestamp: new Date().toISOString(),
    });
    this.eventBroker?.emit({
      type: "agent-turn",
      data: {
        agentId: "prompted-creator-agent",
        trigger: `prompt:${prompt}`,
        targetScreenId,
        summary: result.summary,
        time: new Date().toISOString(),
      },
    });
  }

  private ensureTargetSpec(targetScreenId: string): UiScreenSpec {
    const slot = this.state.ensureScreen(targetScreenId);
    if (slot.spec) {
      return structuredClone(slot.spec);
    }
    if (slot.managedBy === "context-reactive-agent") {
      return structuredClone(this.reactiveAgent.composeScreen(slot.screenId, "init_before_prompt"));
    }
    return structuredClone(this.reactiveAgent.composeDefaultOperatorWorkspace(slot.screenId, "init_before_prompt"));
  }

  private appendPanelToSpec(
    spec: UiScreenSpec,
    panel: UiPanelNode,
    reason: string,
    layoutMode?: "grid" | "document"
  ): UiScreenSpec {
    const next = structuredClone(spec);
    if (layoutMode) {
      next.layoutMode = layoutMode;
    }
    next.updatedAt = new Date().toISOString();
    next.reason = reason;
    next.generatedBy = "prompted-creator-agent";
    if (next.divisions.length === 0) {
      next.divisions.push({
        type: "division",
        id: "div-main",
        direction: next.layoutMode === "document" ? "vertical" : "grid",
        columns: next.layoutMode === "document" ? 1 : 2,
        gap: "md",
        divided: false,
        slots: [{ id: "slot-main-1", colSpan: 1, panels: [panel] }],
      });
    } else {
      const targetDiv = next.divisions[0]!;
      if (targetDiv.slots.length === 0) {
        targetDiv.slots.push({ id: "slot-main-1", colSpan: 1, panels: [panel] });
      } else {
        targetDiv.slots[0]!.panels.push(panel);
      }
    }
    return this.state.setScreenSpec(next.screenId, next);
  }

  private trySpecialCommandCompile(
    promptText: string,
    targetScreenId: string,
    durability: "persistent" | "broadcast",
    ctx: BroadcastContextState,
    mouse: MouseSelectionContext | null,
    lastMsg: ReturnType<ComposerState["getLastMessageContext"]>,
    contextUsed: PromptExecutionResult["contextUsed"]
  ): PromptExecutionResult | null {
    const lower = promptText.toLowerCase();
    const condition = parseVisibilityConditionFromPrompt(promptText);
    const timed = parseTimedVisibilitySec(promptText);

    // 0A. Direct Broadcast Execution Guard
    // The UI Creator agent NEVER executes live broadcast commands directly.
    if (isDirectBroadcastCommand(promptText)) {
      const spec = this.ensureTargetSpec(targetScreenId);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: spec.screenId,
        summary:
          "The UI agent designs and manages UI layouts, components, and UI cues, but does not execute live broadcast commands directly. To execute broadcast actions, either add an action button to your UI (e.g. 'add button to cut to cam 1') or summon an operational agent (e.g. 'summon agent chat') to control the broadcast via conversational chat.",
        screen: spec,
        contextUsed,
      };
    }

    // 0B. Summon Operational Agent Chat Prompt Bar: e.g. "summon agent", "add chat prompt bar", "summon copilot"
    if (
      /\b(?:summon|add|bring|mount|open)\s+(?:an?\s+)?(?:agent|chat|copilot|operator)(?:\s+(?:prompt|bar|widget|controls?))?\b/i.test(
        promptText
      ) ||
      /\b(?:agent\s+chat|chat\s+prompt\s+bar)\b/i.test(promptText)
    ) {
      const spec = this.ensureTargetSpec(targetScreenId);
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-agent-chat-${Date.now()}`,
        title: "Operational Agent — Live Copilot",
        subtitle: "Conversational broadcast switcher & director assistant",
        icon: "smart_toy",
        tone: "default",
        zone: "main",
        sourceLabel: "Summoned Agent",
        collapsible: false,
        collapsed: false,
        pinned: true,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        actions: [
          {
            id: `act-agent-pause-${Date.now()}`,
            label: "Pause Agent",
            action: "dispatch",
            params: { target: "agent", command: "pause" },
            variant: "secondary",
            icon: "pause",
          },
        ],
        children: [
          {
            type: "component",
            id: `comp-agent-card-${Date.now()}`,
            component: "agent-card",
            props: {
              name: "Broadcast Copilot",
              role: "Autonomous switcher & operator assistant",
              status: "online",
              model: "qwen2.5:7b-instruct",
            },
            actions: [],
          },
          {
            type: "component",
            id: `comp-agent-toolbar-${Date.now()}`,
            component: "agent-control-toolbar",
            props: {
              agentId: "copilot",
              status: "online",
              activeTarget: "ATEM / Cameras / Audio",
            },
            actions: [],
          },
          {
            type: "component",
            id: `comp-agent-chat-${Date.now()}`,
            component: "agent-chat-bubble",
            props: {
              speaker: "Copilot",
              role: "assistant",
              message:
                "Operational Agent ready. Use this summoned prompt bar to issue live broadcast commands (e.g. cut cameras, set presets, adjust faders) or ask for operational assistance.",
            },
            actions: [],
          },
        ],
      };

      const updated = this.appendPanelToSpec(spec, panel, "Summoned Operational Agent Chat Bar");
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: updated.screenId,
        summary: `Summoned operational agent chat prompt bar on ${updated.screenId}`,
        screen: updated,
        contextUsed,
      };
    }

    // 0C. UI-Cues: e.g. "show button that puts graveyard graphic on dsk if speaker speaks about resurrection"
    const phraseCueMatch =
      /\b(?:if|when|whenever)\s+(?:speaker\s+speaks\s+about|phrase|word|topic|spoken)\s+["']?([a-zA-Z0-9_\s-]+?)["']?(?:\b|$)/i.exec(
        promptText
      );
    if (phraseCueMatch) {
      const phrase = phraseCueMatch[1]!.trim().toLowerCase();
      const parsedAction = parseActionTargetsFromPrompt(promptText);
      const actionTargets = parsedAction?.targets ?? [
        { dsk: { id: 1, graphic: "graveyard", onAir: true } },
      ];
      const actionLabel = parsedAction?.label ?? "DSK Graphic Overlay";

      const ruleName = `UI-Cue: ${actionLabel} (phrase: "${phrase}")`;
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-uicue-${Date.now()}`,
        title: actionLabel,
        subtitle: `Triggered when phrase "${phrase}" is spoken in broadcast STT`,
        icon: "graphic_eq",
        tone: "standing-rule",
        zone: "main",
        sourceLabel: `UI-Cue: phrase "${phrase}"`,
        collapsible: false,
        collapsed: false,
        pinned: true,
        actions: [
          {
            id: `act-uicue-btn-${Date.now()}`,
            label: actionLabel,
            action: "dispatch",
            params: {},
            targets: actionTargets,
            variant: "primary",
            icon: "visibility",
          },
        ],
        children: [
          {
            type: "component",
            id: `comp-uicue-btn-${Date.now()}`,
            component: "button",
            props: {
              label: actionLabel,
              variant: "primary",
              icon: "layers",
            },
            actions: [
              {
                id: `act-uicue-inner-${Date.now()}`,
                label: actionLabel,
                action: "dispatch",
                params: {},
                targets: actionTargets,
                variant: "primary",
                icon: "layers",
              },
            ],
          },
        ],
      };

      const createdRule = this.rulesStore.addRule({
        name: ruleName,
        description: promptText,
        promptText,
        targetScreenId,
        targetZone: "main",
        container: "panel",
        durability,
        enabled: true,
        trigger: {
          phase: "live",
          section: condition?.section ?? null,
          conditionOperator: condition?.operator ?? "during",
          directorState: "any",
          audioClassification: "any",
          phrase,
          phraseHoldSec: 120,
        },
        panel,
      });

      this.reactiveAgent.composeAll(`standing_rule_added:${createdRule.id}`);
      const updatedScreen =
        this.state.getScreen(targetScreenId)?.spec ??
        this.reactiveAgent.composeScreen(targetScreenId, `standing_rule:${createdRule.id}`);

      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "standing_rule",
        source: "deterministic-compiler",
        targetScreenId,
        summary: `Created UI-cue '${ruleName}' on ${targetScreenId} (triggered when phrase "${phrase}" is heard)`,
        rule: createdRule,
        screen: updatedScreen,
        contextUsed,
      };
    }

    // 0D. Button with action targets: e.g. Button to issue "cam1 preset 4, cut after moved"
    const parsedTargets = parseActionTargetsFromPrompt(promptText);
    if (parsedTargets && /\b(button|controls?|action|bind)\b/i.test(promptText)) {
      const spec = this.ensureTargetSpec(targetScreenId);
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-action-btn-${Date.now()}`,
        title: parsedTargets.label,
        subtitle: `Bound hardware target(s): ${parsedTargets.targets.map((t) => JSON.stringify(t)).join(", ")}`,
        icon: "touch_app",
        tone: "default",
        zone: "main",
        sourceLabel: "Prompted Action Target",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [
          {
            id: `act-dispatch-target-${Date.now()}`,
            label: parsedTargets.label,
            action: "dispatch",
            params: {},
            targets: parsedTargets.targets,
            variant: "primary",
            icon: "play_arrow",
          },
        ],
        children: [
          {
            type: "component",
            id: `comp-button-target-${Date.now()}`,
            component: "button",
            props: {
              label: parsedTargets.label,
              variant: "primary",
              icon: "touch_app",
            },
            actions: [
              {
                id: `act-btn-target-${Date.now()}`,
                label: parsedTargets.label,
                action: "dispatch",
                params: {},
                targets: parsedTargets.targets,
                variant: "primary",
                icon: "touch_app",
              },
            ],
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          },
        ],
      };

      const updated = this.appendPanelToSpec(spec, panel, `Added button: ${parsedTargets.label}`);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: updated.screenId,
        summary: `Added button '${parsedTargets.label}' mapped to action target(s) on ${updated.screenId}`,
        screen: updated,
        contextUsed,
      };
    }

    // 0E. Sent Captions feed: e.g. "show me sent captions while sermon is going on"
    if (
      /\b(?:captions?|subtitles?)\b/i.test(lower) &&
      /\b(?:sent|youtube|relay|feed)\b/i.test(lower)
    ) {
      const spec = this.ensureTargetSpec(targetScreenId);
      const isSentOnly = /\b(?:sent|delivered)\b/i.test(lower);
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-captions-feed-${Date.now()}`,
        title: isSentOnly ? "Live Sent Captions Feed" : "Live Captions Monitor",
        subtitle: isSentOnly
          ? "Filtered to captions sent to broadcast stream / YouTube"
          : "Full sanctuary speech-to-text feed",
        icon: "subtitles",
        tone: "default",
        zone: "main",
        sourceLabel: "Captions Feed",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [],
        children: [
          {
            type: "component",
            id: `comp-captions-feed-${Date.now()}`,
            component: "live-captions-feed",
            props: {
              sentOnly: isSentOnly,
              isVoiceActive: ctx.hardware.voiceActive,
            },
            actions: [],
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          },
        ],
      };

      const updated = this.appendPanelToSpec(spec, panel, "Added sent captions feed");
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: updated.screenId,
        summary: `Added ${isSentOnly ? "sent" : "live"} captions feed on ${updated.screenId}${condition ? ` (condition: ${condition.operator} ${condition.section})` : ""}`,
        screen: updated,
        contextUsed,
      };
    }

    // A. Save Named UI Component: e.g. "save these as sermon controls" or "save this as audio strip"
    const saveMatch = /\bsave\s+(?:these|this|selection|components?|panels?)\s+as\s+["']?(.+?)["']?$/i.exec(
      promptText.trim()
    );
    if (saveMatch) {
      const name = saveMatch[1]!.trim();
      const spec = this.ensureTargetSpec(targetScreenId);
      const allPanels = spec.divisions.flatMap((d) => d.slots.flatMap((s) => s.panels));
      let selectedPanels: UiPanelNode[] = [];
      let selectedComponents: UiComponentNode[] = [];

      if (mouse && mouse.mode === "component") {
        if (mouse.panelId) {
          selectedPanels = allPanels.filter((p) => p.id === mouse.panelId);
        }
        if (mouse.componentId) {
          selectedComponents = allPanels
            .flatMap((p) => p.children)
            .filter((c) => c.id === mouse.componentId);
        }
      } else if (mouse && mouse.mode === "rectangle") {
        const panelIds = new Set(mouse.overlappingPanelIds ?? []);
        const compIds = new Set(mouse.overlappingComponentIds ?? []);
        if (panelIds.size > 0) {
          selectedPanels = allPanels.filter((p) => panelIds.has(p.id));
        }
        if (compIds.size > 0) {
          selectedComponents = allPanels
            .flatMap((p) => p.children)
            .filter((c) => compIds.has(c.id));
        }
      }
      if (selectedPanels.length === 0 && selectedComponents.length === 0) {
        selectedPanels = allPanels.slice(0, 2);
      }

      const saved = this.state.savedComponentsStore.saveComponent({
        name,
        description: `Saved from ${spec.pageName}/${spec.viewNumber} via command "${promptText}"`,
        panels: structuredClone(selectedPanels),
        components: structuredClone(selectedComponents),
        sourcePage: spec.pageName,
        sourceView: spec.viewNumber,
      });

      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "save_component",
        source: "deterministic-compiler",
        targetScreenId: spec.screenId,
        summary: `Saved ${selectedPanels.length} panel(s) and ${selectedComponents.length} component(s) as reusable component "${saved.name}" (${saved.slug})`,
        savedComponent: saved,
        screen: spec,
        contextUsed,
      };
    }

    // B. Insert / Mount a previously Saved Named UI Component: e.g. "insert sermon controls" or "add sermon controls"
    for (const saved of this.state.savedComponentsStore.list()) {
      const nameLower = saved.name.toLowerCase();
      const slugLower = saved.slug.toLowerCase();
      if (
        (lower.includes(nameLower) || lower.includes(slugLower)) &&
        /\b(insert|add|mount|show|load|use|place)\b/i.test(lower) &&
        !lower.startsWith("save ")
      ) {
        const spec = this.ensureTargetSpec(targetScreenId);
        const panelsToMount: UiPanelNode[] =
          saved.panels.length > 0
            ? saved.panels.map((p, idx) => ({
                ...structuredClone(p),
                id: `${p.id}-mounted-${Date.now()}-${idx}`,
                savedComponentName: saved.name,
                ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
                ...(condition ? { condition } : {}),
                ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
              }))
            : [
                {
                  type: "panel",
                  id: `panel-saved-${saved.slug}-${Date.now()}`,
                  title: saved.name,
                  subtitle: `Saved UI component (${saved.slug})`,
                  icon: "widgets",
                  tone: "default",
                  zone: "main",
                  savedComponentName: saved.name,
                  collapsible: false,
                  collapsed: false,
                  pinned: false,
                  ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
                  ...(condition ? { condition } : {}),
                  ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
                  actions: [],
                  children: saved.components.map((c, idx) => ({
                    ...structuredClone(c),
                    id: `${c.id}-mounted-${Date.now()}-${idx}`,
                  })),
                },
              ];

        let updated = spec;
        for (const p of panelsToMount) {
          updated = this.appendPanelToSpec(updated, p, `Mounted saved component "${saved.name}"`);
        }
        return {
          ok: true,
          agentId: "prompted-creator-agent",
          intent: "screen_layout",
          source: "deterministic-compiler",
          targetScreenId: updated.screenId,
          summary: `Mounted saved component "${saved.name}" on ${updated.screenId}`,
          savedComponent: saved,
          screen: updated,
          contextUsed,
        };
      }
    }

    // C. Mouse Component Removal: e.g. click component + "Remove this" / "Delete this"
    if (
      mouse &&
      mouse.mode !== "none" &&
      /\b(remove|delete|hide|drop)\b/i.test(lower) &&
      /\b(this|selected|component|panel|here|area)\b/i.test(lower)
    ) {
      const spec = this.ensureTargetSpec(targetScreenId);
      const targetCompIds = new Set<string>([
        ...(mouse.componentId ? [mouse.componentId] : []),
        ...(mouse.overlappingComponentIds ?? []),
      ]);
      const targetPanelIds = new Set<string>([
        ...(mouse.panelId ? [mouse.panelId] : []),
        ...(mouse.overlappingPanelIds ?? []),
      ]);

      let removedCount = 0;
      const nextDivisions = spec.divisions.map((div) => ({
        ...div,
        slots: div.slots.map((slot) => {
          const keptPanels: UiPanelNode[] = [];
          for (const panel of slot.panels) {
            if (targetPanelIds.has(panel.id) && targetCompIds.size === 0) {
              removedCount++;
              continue;
            }
            const beforeChildren = panel.children.length;
            const filteredChildren = panel.children.filter((c) => !targetCompIds.has(c.id));
            if (filteredChildren.length < beforeChildren) {
              removedCount += beforeChildren - filteredChildren.length;
            }
            if (filteredChildren.length === 0 && targetPanelIds.has(panel.id)) {
              removedCount++;
              continue;
            }
            keptPanels.push({
              ...panel,
              children: filteredChildren,
            });
          }
          return { ...slot, panels: keptPanels };
        }),
      }));

      const updated: UiScreenSpec = {
        ...spec,
        updatedAt: new Date().toISOString(),
        reason: `Removed selected UI element(s): "${promptText}"`,
        divisions: nextDivisions,
      };
      this.state.setScreenSpec(spec.screenId, updated);
      this.state.clearMouseContext(spec.pageName, spec.viewNumber);

      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "modify_selection",
        source: "deterministic-compiler",
        targetScreenId: spec.screenId,
        summary: `Removed ${removedCount || 1} selected item(s) from ${spec.screenId}`,
        screen: updated,
        contextUsed,
      };
    }

    // D. Wireless Mics Sound Controls (e.g. draw rectangle + "add here sound controls for wireless mics 1,2,5")
    if (/\b(wireless|mic(?:rophone)?s?|sound\s+controls?|faders?)\b/i.test(lower)) {
      const nums = Array.from(promptText.matchAll(/\b(\d{1,2})\b/g))
        .map((m) => Number.parseInt(m[1]!, 10))
        .filter((n) => n >= 1 && n <= 32);
      if (nums.length > 0 || lower.includes("wireless")) {
        const channels = nums.length > 0 ? Array.from(new Set(nums)) : [1, 2];
        const spec = this.ensureTargetSpec(targetScreenId);
        const panel: UiPanelNode = {
          type: "panel",
          id: `panel-wireless-mics-${channels.join("-")}`,
          title: `Sound Controls — Wireless Mics ${channels.join(", ")}`,
          subtitle: mouse?.rect
            ? `Placed at (${mouse.rect.x}, ${mouse.rect.y}) ${mouse.rect.width}×${mouse.rect.height}`
            : `Prompted: "${promptText}"`,
          icon: "mic",
          tone: "default",
          zone: "main",
          sourceLabel: mouse?.rect ? "Area Selection" : "Prompted UI",
          collapsible: false,
          collapsed: false,
          pinned: false,
          ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
          ...(condition ? { condition } : {}),
          ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          actions: channels.map((ch) => ({
            id: `act-mute-mic-${ch}`,
            label: `Mute Mic ${ch}`,
            action: "audio.mute",
            params: { channel: ch, id: `wireless-${ch}` },
            variant: "secondary" as const,
            icon: "mic_off",
          })),
          children: [
            {
              type: "component",
              id: `comp-wireless-bank-${channels.join("-")}`,
              component: "wireless-mic-bank",
              props: {
                channels: channels.map((ch) => ({
                  channel: ch,
                  id: `wireless-${ch}`,
                  label: `Wireless Mic ${ch}`,
                  volumePercent: 80,
                  muted: false,
                })),
              },
              actions: [],
              ...(condition ? { condition } : {}),
              ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
            },
            ...channels.map((ch) => ({
              type: "component" as const,
              id: `comp-fader-mic-${ch}`,
              component: "audio-fader" as const,
              props: {
                id: `wireless-${ch}`,
                channel: ch,
                name: `Wireless Mic ${ch}`,
                volumePercent: 80,
              },
              actions: [],
            })),
          ],
        };
        const updated = this.appendPanelToSpec(spec, panel, `Added Wireless Mics ${channels.join(", ")}`);
        return {
          ok: true,
          agentId: "prompted-creator-agent",
          intent: "screen_layout",
          source: "deterministic-compiler",
          targetScreenId: updated.screenId,
          summary: `Added sound controls for wireless mics ${channels.join(", ")} on ${updated.screenId}`,
          screen: updated,
          contextUsed,
        };
      }
    }

    // E. Macro Button (e.g. "Button that turns off graphics and fades to black")
    const isMacroPrompt =
      /\bmacro\b/i.test(lower) ||
      (/\bbutton\b/i.test(lower) && /\band\b/i.test(lower)) ||
      (lower.includes("fade") && lower.includes("black") && lower.includes("graphic"));
    if (isMacroPrompt) {
      const steps: UiMacroStep[] = [];
      if (lower.includes("graphic") || lower.includes("lower third")) {
        const turnOff = /\b(off|hide|clear|disable)\b/i.test(lower);
        steps.push({
          id: "step-graphics",
          label: turnOff ? "Turn Off Graphics" : "Show Graphics",
          action: "graphics.lowerThird",
          params: { showLowerThird: !turnOff },
          delayMs: 0,
        });
      }
      if (lower.includes("fade") || lower.includes("black") || lower.includes("ftb")) {
        steps.push({
          id: "step-ftb",
          label: "Fade to Black (FTB)",
          action: "atem.ftb",
          params: { enabled: true },
          delayMs: steps.length > 0 ? 250 : 0,
        });
      }
      const cutCamMatch = /\bcut\s+to\s+(?:cam(?:era)?|input)\s*(\d+)\b/i.exec(promptText);
      if (cutCamMatch) {
        const inputNum = Number.parseInt(cutCamMatch[1]!, 10);
        steps.push({
          id: `step-cut-${inputNum}`,
          label: `Cut to Input ${inputNum}`,
          action: "atem.cutInput",
          params: { input: inputNum },
          delayMs: steps.length > 0 ? 200 : 0,
        });
      }
      if (lower.includes("mute")) {
        steps.push({
          id: "step-mute",
          label: "Mute Sanctuary Audio",
          action: "audio.muteAll",
          params: { muted: true },
          delayMs: steps.length > 0 ? 200 : 0,
        });
      }
      if (steps.length === 0) {
        steps.push(
          {
            id: "step-1",
            label: "Hide Lower-Third Graphics",
            action: "graphics.lowerThird",
            params: { showLowerThird: false },
            delayMs: 0,
          },
          {
            id: "step-2",
            label: "Fade to Black",
            action: "atem.ftb",
            params: { enabled: true },
            delayMs: 250,
          }
        );
      }

      const macroLabel = steps.map((s) => s.label).join(" + ");
      const spec = this.ensureTargetSpec(targetScreenId);
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-macro-${Date.now()}`,
        title: `Macro Control`,
        subtitle: macroLabel,
        icon: "bolt",
        tone: "default",
        zone: "main",
        sourceLabel: "Macro",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [
          {
            id: `act-macro-${Date.now()}`,
            label: macroLabel,
            action: "macro.execute",
            params: { steps },
            variant: "danger",
            icon: "bolt",
            steps,
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          },
        ],
        children: [
          {
            type: "component",
            id: `comp-macro-${Date.now()}`,
            component: "macro-button",
            props: {
              label: macroLabel,
              description: promptText,
              steps,
            },
            actions: [
              {
                id: `act-comp-macro-${Date.now()}`,
                label: `Run Macro: ${macroLabel}`,
                action: "macro.execute",
                params: { steps },
                variant: "danger",
                steps,
                ...(condition ? { condition } : {}),
                ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
              },
            ],
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          },
        ],
      };

      const updated = this.appendPanelToSpec(spec, panel, `Added macro button: ${macroLabel}`);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: updated.screenId,
        summary: `Added macro button (${macroLabel}) on ${updated.screenId}`,
        screen: updated,
        contextUsed,
      };
    }

    // F. Time-Series Chart (e.g. "chart of audio levels", "time series chart of caption lag", "bitrate chart")
    if (/\b(chart|graph|time\s*-?\s*series|plot|trend)\b/i.test(lower)) {
      let metric: TimeSeriesMetric = "audio_rms_dbfs";
      if (lower.includes("caption") || lower.includes("lag") || lower.includes("subtitle")) {
        metric = "caption_lag_ms";
      } else if (lower.includes("dwell") || lower.includes("shot")) {
        metric = "shot_dwell_sec";
      } else if (lower.includes("bitrate") || lower.includes("stream") || lower.includes("kbps")) {
        metric = "stream_bitrate_kbps";
      } else if (lower.includes("motion") || lower.includes("ptz") || lower.includes("speed")) {
        metric = "camera_motion_speed";
      }
      const series = this.state.timeSeriesStore.getSeries(metric);
      const spec = this.ensureTargetSpec(targetScreenId);
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-chart-${metric}`,
        title: `${series.label} (${series.unit})`,
        subtitle: `Live time-series telemetry (${series.points.length} samples)`,
        icon: "show_chart",
        tone: "default",
        zone: "main",
        sourceLabel: "Telemetry Chart",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [],
        children: [
          {
            type: "component",
            id: `comp-chart-${metric}`,
            component: "timeseries-chart",
            props: {
              metric: series.metric,
              label: series.label,
              unit: series.unit,
              min: series.min,
              max: series.max,
              points: series.points,
            },
            actions: [],
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          },
        ],
      };

      const updated = this.appendPanelToSpec(spec, panel, `Added time-series chart for ${series.label}`);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: updated.screenId,
        summary: `Added time-series chart '${series.label}' (${metric}) on ${updated.screenId}`,
        screen: updated,
        contextUsed,
      };
    }

    // G. Timer Display Component (set time OR rundown time: broadcast, section, item)
    if (/\b(timer|countdown|clock|stopwatch)\b/i.test(lower)) {
      let scope: "broadcast" | "section" | "item" = "item";
      if (lower.includes("broadcast")) scope = "broadcast";
      else if (lower.includes("section")) scope = "section";
      else if (lower.includes("item") || lower.includes("cue")) scope = "item";

      const clockMatch = /\b(\d{1,2}):(\d{2})\b/.exec(promptText);
      const isSetTime =
        lower.includes("set time") ||
        lower.includes("countdown") ||
        (clockMatch !== null && !lower.includes("rundown"));
      const setDurationSec = clockMatch
        ? Number.parseInt(clockMatch[1]!, 10) * 60 + Number.parseInt(clockMatch[2]!, 10)
        : timed.showForSec ?? 300;

      const mode = isSetTime ? "set-time" : "rundown";
      const label =
        mode === "set-time"
          ? `Set Timer (${Math.floor(setDurationSec / 60)}:${String(setDurationSec % 60).padStart(2, "0")})`
          : `Rundown Timer (${scope.toUpperCase()})`;

      const spec = this.ensureTargetSpec(targetScreenId);
      const panel: UiPanelNode = {
        type: "panel",
        id: `panel-timer-${mode}-${scope}-${Date.now()}`,
        title: label,
        subtitle:
          mode === "rundown"
            ? `Tracking ${scope} timing (${ctx.rundown.placeInEvent ?? "Live"})`
            : `Fixed countdown timer (${setDurationSec}s)`,
        icon: "timer",
        tone: "default",
        zone: "main",
        sourceLabel: "Timer",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec && !isSetTime
          ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt }
          : {}),
        actions: [],
        children: [
          {
            type: "component",
            id: `comp-timer-${mode}-${scope}`,
            component: "timer-display",
            props: {
              mode,
              scope,
              label,
              setDurationSec: mode === "set-time" ? setDurationSec : ctx.rundown.timerSec ?? ctx.rundown.expectedDurationSec ?? 180,
              startedAt:
                scope === "broadcast"
                  ? ctx.broadcastStartedAt
                  : scope === "section"
                    ? ctx.sectionStartedAt
                    : ctx.itemStartedAt,
              overtime: ctx.rundown.overtime,
            },
            actions: [],
            ...(condition ? { condition } : {}),
          },
        ],
      };

      const updated = this.appendPanelToSpec(spec, panel, `Added ${label}`);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: updated.screenId,
        summary: `Added ${label} on ${updated.screenId}`,
        screen: updated,
        contextUsed,
      };
    }

    // H. Long-Form Scrolling Document Layout switch
    if (/\b(long\s+document|scrolling\s+document|document\s+layout|scroll\s+view)\b/i.test(lower)) {
      const spec = this.ensureTargetSpec(targetScreenId);
      spec.layoutMode = "document";
      spec.updatedAt = new Date().toISOString();
      spec.reason = `Switched to scrolling document layout: "${promptText}"`;
      const saved = this.state.setScreenSpec(spec.screenId, spec);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: saved.screenId,
        summary: `Switched ${saved.screenId} to long scrolling document layout`,
        screen: saved,
        contextUsed,
      };
    }

    // I. Last Message Refinement (e.g. when useLastMessageContext is true and user says "make it a hover" or "only show after sermon has passed" or "show for 5 minutes")
    if (lastMsg && (condition || timed.showForSec)) {
      const spec = this.ensureTargetSpec(targetScreenId);
      const allPanels = spec.divisions.flatMap((d) => d.slots.flatMap((s) => s.panels));
      const lastPanel = allPanels[allPanels.length - 1];
      if (lastPanel && !/\b(add|create|build)\b/i.test(lower)) {
        if (condition) lastPanel.condition = condition;
        if (timed.showForSec) {
          lastPanel.showForSec = timed.showForSec;
          lastPanel.expiresAt = timed.expiresAt;
        }
        const saved = this.state.setScreenSpec(spec.screenId, spec);
        return {
          ok: true,
          agentId: "prompted-creator-agent",
          intent: "screen_layout",
          source: "deterministic-compiler",
          targetScreenId: saved.screenId,
          summary: `Refined previous UI element on ${saved.screenId} (${promptText})`,
          screen: saved,
          contextUsed,
        };
      }
    }

    return null;
  }

  private async tryOllamaCompile(
    promptText: string,
    targetScreenId: string,
    durability: "persistent" | "broadcast" | undefined,
    ctx: BroadcastContextState | null,
    mouse: MouseSelectionContext | null,
    lastMsg: ReturnType<ComposerState["getLastMessageContext"]>,
    contextUsed: PromptExecutionResult["contextUsed"]
  ): Promise<PromptExecutionResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const system = `You are the Prompted UI Creator Agent ("ui-prompt-creator") in picomposer.
You are NOT the broadcast director — you never switch cameras or issue shot advisories.
You generate typed JSON UI specifications or Standing UI Rules using @piecosystem/piui layout primitives (panel, division, hover, document) and molecules (graphics-lower-third-panel, preflight-checklist-card, atem-bus-selector, ptz-pad, ptz-preset-card, tally-facet-widget, cue-button-group, audio-fader, wireless-mic-bank, macro-button, timer-display, timeseries-chart, rundown-item-card, stream-status-card, live-captions-feed, steering-notes-list, decision-log-list).
Respond ONLY with valid JSON:
{
  "intent": "standing_rule" | "screen_layout",
  "summary": "Human readable explanation",
  "rule": { ...StandingUiRuleCreate... },
  "screen": { ...UiScreenSpec... }
}`;

      const res = await this.fetchFn(`${this.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: JSON.stringify({
                prompt: promptText,
                targetScreenId,
                durability: durability ?? "persistent",
                ...(ctx ? { broadcastContext: ctx } : {}),
                ...(mouse ? { mouseContext: mouse } : {}),
                ...(lastMsg ? { lastMessageContext: lastMsg } : {}),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) return null;
      const body = (await res.json()) as { message?: { content?: string } };
      const parsed = JSON.parse(body.message?.content ?? "{}");

      if (parsed.intent === "standing_rule" && parsed.rule) {
        const validatedRule = StandingUiRuleCreateSchema.parse({
          ...parsed.rule,
          promptText,
          targetScreenId: parsed.rule.targetScreenId ?? targetScreenId,
          durability: durability ?? parsed.rule.durability ?? "persistent",
        });
        const createdRule = this.rulesStore.addRule(validatedRule);
        this.reactiveAgent.composeAll(`standing_rule_added:${createdRule.id}`);
        const screen =
          this.state.getScreen(targetScreenId)?.spec ??
          this.reactiveAgent.composeScreen(targetScreenId, `standing_rule:${createdRule.id}`);

        return {
          ok: true,
          agentId: "prompted-creator-agent",
          intent: "standing_rule",
          source: "ollama",
          targetScreenId,
          summary: parsed.summary ?? `Created standing UI rule '${createdRule.name}'`,
          rule: createdRule,
          screen,
          contextUsed,
        };
      }

      if (parsed.intent === "screen_layout" && parsed.screen) {
        const slot = this.state.ensureScreen(targetScreenId);
        const validatedScreen = UiScreenSpecSchema.parse({
          ...parsed.screen,
          screenId: targetScreenId,
          pageName: slot.pageName,
          viewNumber: slot.viewNumber,
          generatedBy: "prompted-creator-agent",
          updatedAt: new Date().toISOString(),
        });
        const saved = this.state.setScreenSpec(targetScreenId, validatedScreen);
        return {
          ok: true,
          agentId: "prompted-creator-agent",
          intent: "screen_layout",
          source: "ollama",
          targetScreenId,
          summary: parsed.summary ?? `Generated custom layout for ${targetScreenId}`,
          screen: saved,
          contextUsed,
        };
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private compileDeterministically(
    promptText: string,
    targetScreenId: string,
    durability: "persistent" | "broadcast",
    ctx: BroadcastContextState,
    mouse: MouseSelectionContext | null,
    _lastMsg: ReturnType<ComposerState["getLastMessageContext"]>,
    contextUsed: PromptExecutionResult["contextUsed"]
  ): PromptExecutionResult {
    const lower = promptText.toLowerCase();
    const condition = parseVisibilityConditionFromPrompt(promptText);
    const timed = parseTimedVisibilitySec(promptText);

    const isStandingRequest =
      /\b(during|when|whenever|always|every\s+time|standing|after\s+.*\s+passed)\b/i.test(promptText);

    if (isStandingRequest) {
      let section: string | null = condition?.section ?? null;
      if (!section) {
        if (lower.includes("sermon") || lower.includes("saarna")) {
          section = "sermon";
        } else if (lower.includes("prayer") || lower.includes("rukous") || lower.includes("intercession")) {
          section = "intercession";
        } else if (lower.includes("communion") || lower.includes("ehtoollinen")) {
          section = "communion";
        } else if (lower.includes("hymn") || lower.includes("virsi") || lower.includes("intro")) {
          section = "intro";
        }
      }

      const conditionOperator = condition?.operator ?? "during";
      const wantsHover = lower.includes("hover") || lower.includes("overlay") || lower.includes("popover");
      const wantsGraphics =
        lower.includes("graphic") || lower.includes("lower third") || lower.includes("alanimi") || lower.includes("title");

      const ruleName = wantsGraphics
        ? `Graphics Controls (${section ? `${conditionOperator} ${section}` : "Standing"})`
        : `Custom Controls (${section ? `${conditionOperator} ${section}` : "Standing"})`;

      const panel: UiPanelNode = wantsGraphics
        ? {
            type: "panel",
            id: `panel-rule-graphics-${section ?? "live"}`,
            title: "Lower-Third Graphics & Titles",
            subtitle: section ? `Auto-mounted ${conditionOperator} ${section}` : "Standing UI Rule",
            icon: "subtitles",
            tone: "standing-rule",
            zone: "main",
            sourceLabel: `Standing Rule: ${conditionOperator} ${section ?? "always"}`,
            collapsible: false,
            collapsed: false,
            pinned: true,
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
            actions: [
              {
                id: "act-show-lower-third",
                label: "Show Lower Third",
                action: "graphics.lowerThird",
                params: {
                  showLowerThird: true,
                },
                variant: "primary",
                icon: "visibility",
              },
              {
                id: "act-hide-lower-third",
                label: "Hide Lower Third",
                action: "graphics.lowerThird",
                params: { showLowerThird: false },
                variant: "secondary",
                icon: "visibility_off",
              },
            ],
            children: [
              {
                type: "component",
                id: "comp-rule-lower-third",
                component: "graphics-lower-third-panel",
                props: {
                  autoShowSec: 8,
                },
                actions: [],
              },
            ],
          }
        : {
            type: "panel",
            id: `panel-rule-custom-${Date.now()}`,
            title: ruleName,
            subtitle: promptText,
            icon: "widgets",
            tone: "standing-rule",
            zone: "main",
            sourceLabel: `Standing Rule`,
            collapsible: false,
            collapsed: false,
            pinned: true,
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
            actions: [],
            children: [
              {
                type: "component",
                id: "comp-rule-presets",
                component: "ptz-preset-card",
                props: { camera: 2, prompt: promptText },
                actions: [],
              },
            ],
          };

      const createdRule = this.rulesStore.addRule({
        name: ruleName,
        description: promptText,
        promptText,
        targetScreenId,
        targetZone: "main",
        container: wantsHover ? "hover" : "panel",
        durability,
        enabled: true,
        trigger: {
          phase: "live",
          section,
          conditionOperator,
          directorState: "any",
          audioClassification: lower.includes("music") ? "music" : "any",
        },
        ...(wantsHover
          ? {
              hover: {
                type: "hover",
                id: `hover-rule-${section ?? "live"}`,
                title: panel.title,
                subtitle: panel.subtitle,
                placement: "bottom-right",
                tone: "neutral",
                dismissible: true,
                pinned: true,
                actions: panel.actions,
                children: panel.children,
              },
            }
          : { panel }),
      });

      this.reactiveAgent.composeAll(`standing_rule_added:${createdRule.id}`);
      const updatedScreen =
        this.state.getScreen(targetScreenId)?.spec ??
        this.reactiveAgent.composeScreen(targetScreenId, `standing_rule:${createdRule.id}`);

      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "standing_rule",
        source: "deterministic-compiler",
        targetScreenId,
        summary: `Registered standing UI rule '${createdRule.name}' on ${targetScreenId}${section ? ` (trigger: ${conditionOperator} ${section})` : ""}`,
        rule: createdRule,
        screen: updatedScreen,
        contextUsed,
      };
    }

    const slot = this.state.ensureScreen(targetScreenId, {
      managedBy: "prompted-creator-agent",
    });

    const panels: UiPanelNode[] = [];

    if (lower.includes("preflight") || lower.includes("setup") || lower.includes("check")) {
      const preflightSpec = this.reactiveAgent.composeScreen("screen-3", `prompt:${promptText}`);
      const cloned: UiScreenSpec = {
        ...preflightSpec,
        screenId: slot.screenId,
        pageName: slot.pageName,
        viewNumber: slot.viewNumber,
        screenName: slot.screenName,
        generatedBy: "prompted-creator-agent",
        reason: `Prompted: ${promptText}`,
      };
      this.state.setScreenSpec(slot.screenId, cloned);
      return {
        ok: true,
        agentId: "prompted-creator-agent",
        intent: "screen_layout",
        source: "deterministic-compiler",
        targetScreenId: slot.screenId,
        summary: `Composed Setup & Preflight workspace on ${slot.screenId}`,
        screen: cloned,
        contextUsed,
      };
    }

    if (lower.includes("graphic") || lower.includes("lower third") || lower.includes("slide")) {
      panels.push({
        type: "panel",
        id: "panel-prompted-graphics",
        title: "Graphics & Lower Third Controls",
        subtitle: `Prompted: "${promptText}"`,
        icon: "subtitles",
        tone: "default",
        zone: "main",
        sourceLabel: "Prompted UI",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [
          {
            id: "act-prompt-lt-show",
            label: "Show Lower Third",
            action: "graphics.lowerThird",
            params: {
              showLowerThird: true,
              title: ctx.rundown.currentCueTitle ?? "Messu",
              subtitle: ctx.rundown.assignedSpeaker ?? "Liturgi",
            },
            variant: "primary",
            ...(condition ? { condition } : {}),
            ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
          },
        ],
        children: [
          {
            type: "component",
            id: "comp-prompted-lt",
            component: "graphics-lower-third-panel",
            props: {
              title: ctx.rundown.currentCueTitle ?? "Messu",
              subtitle: ctx.rundown.assignedSpeaker ?? "Liturgi",
            },
            actions: [],
          },
        ],
      });
    }

    if (lower.includes("ptz") || lower.includes("cam") || lower.includes("preset") || panels.length === 0) {
      panels.push({
        type: "panel",
        id: "panel-prompted-cameras",
        title: "Camera PTZ & Presets Workspace",
        subtitle: `Prompted: "${promptText}"`,
        icon: "videocam",
        tone: "default",
        zone: "main",
        sourceLabel: "Prompted UI",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(mouse?.rect ? { rectHint: mouse.rect } : {}),
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [],
        children: [
          {
            type: "component",
            id: "comp-prompted-ptz-pad",
            component: "ptz-pad",
            props: { camera: 2 },
            actions: [],
          },
          {
            type: "component",
            id: "comp-prompted-presets",
            component: "ptz-preset-card",
            props: { camera: 2, presets: ["Altar", "Pulpit", "Choir"] },
            actions: [],
          },
        ],
      });
    }

    if (lower.includes("tally") || lower.includes("cue")) {
      panels.push({
        type: "panel",
        id: "panel-prompted-tally",
        title: "Tally Lights & Camera Operator Cues",
        subtitle: "Wireless Tally-Ma facet & cue controls",
        icon: "lightbulb",
        tone: "default",
        zone: "sidebar",
        sourceLabel: "Prompted UI",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [],
        children: [
          {
            type: "component",
            id: "comp-prompted-tally-cues",
            component: "cue-button-group",
            props: { targetLightId: "tally02", targetLightName: "Camera 2" },
            actions: [],
          },
        ],
      });
    }

    if (lower.includes("audio") || lower.includes("voice") || lower.includes("caption")) {
      panels.push({
        type: "panel",
        id: "panel-prompted-audio",
        title: "Audio & Live Captions Monitor",
        subtitle: "Sanctuary microphones & STT feed",
        icon: "graphic_eq",
        tone: "default",
        zone: "sidebar",
        sourceLabel: "Prompted UI",
        collapsible: false,
        collapsed: false,
        pinned: false,
        ...(condition ? { condition } : {}),
        ...(timed.showForSec ? { showForSec: timed.showForSec, expiresAt: timed.expiresAt } : {}),
        actions: [],
        children: [
          {
            type: "component",
            id: "comp-prompted-fader",
            component: "audio-fader",
            props: { id: "pulpit", name: "Pulpit Mic", volumePercent: 80 },
            actions: [],
          },
          {
            type: "component",
            id: "comp-prompted-captions",
            component: "live-captions-feed",
            props: { isVoiceActive: ctx.hardware.voiceActive },
            actions: [],
          },
        ],
      });
    }

    const matchingRules = this.rulesStore.getMatchingRules(ctx, slot.screenId);
    const layoutMode =
      /\b(document|scroll)\b/i.test(lower) ? "document" : slot.spec?.layoutMode ?? "grid";

    const screenSpec: UiScreenSpec = {
      screenId: slot.screenId,
      pageName: slot.pageName,
      viewNumber: slot.viewNumber,
      screenName: slot.screenName,
      role: slot.role,
      layoutMode,
      generatedBy: "prompted-creator-agent",
      updatedAt: new Date().toISOString(),
      reason: `Prompted: ${promptText}`,
      broadcastPhase: ctx.phase,
      directorMode: ctx.director.mode,
      contextSummary: {
        broadcastId: ctx.director.broadcastId ?? ctx.pitube.broadcastId,
        broadcastTitle: ctx.pitube.title ?? ctx.rundown.title,
        placeInEvent: ctx.rundown.placeInEvent,
        activeSection: ctx.rundown.currentSection,
        activeSubsection: ctx.rundown.currentSubsection,
        completedSections: [...ctx.rundown.completedSections],
        timingSummary: ctx.rundown.timingSummary,
        nextItemTitle: ctx.rundown.nextItem?.title ?? null,
        programInput: ctx.hardware.programInput,
        previewInput: ctx.hardware.previewInput,
      },
      activeStandingRuleIds: matchingRules.map((r) => r.id),
      divisions: [
        {
          type: "division",
          id: "div-prompted-workspace",
          direction: layoutMode === "document" ? "vertical" : "grid",
          columns: layoutMode === "document" ? 1 : panels.length > 1 ? 2 : 1,
          gap: "md",
          divided: false,
          slots: panels.map((p, idx) => ({
            id: `slot-prompted-${idx + 1}`,
            colSpan: 1 as const,
            panels: [p],
          })),
        },
      ],
      hovers: [],
    };

    const saved = this.state.setScreenSpec(slot.screenId, screenSpec);
    return {
      ok: true,
      agentId: "prompted-creator-agent",
      intent: "screen_layout",
      source: "deterministic-compiler",
      targetScreenId: slot.screenId,
      summary: `Composed ${panels.length} panel(s) on ${slot.screenId} for prompt: "${promptText}"`,
      screen: saved,
      contextUsed,
    };
  }
}
