import type { ComposerEventBroker } from "../events.js";
import type { StandingRulesStore } from "../rules/standing-rules-store.js";
import {
  StandingUiRuleCreateSchema,
  UiScreenSpecSchema,
  type StandingUiRule,
  type UiPanelNode,
  type UiScreenSpec,
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
  intent: "standing_rule" | "screen_layout";
  source: "ollama" | "deterministic-compiler";
  targetScreenId: string;
  summary: string;
  rule?: StandingUiRule | undefined;
  screen: UiScreenSpec;
}

/**
 * Agent 2: Prompted UI Creator Agent ("ui-prompt-creator")
 *
 * Explicitly NOT the broadcast director (never switches cameras or issues shot advisories).
 * Knows the full state of the broadcast and the @piecosystem/piui component & layout catalog.
 *
 * Responds to operator natural-language prompts to either:
 * 1. Create a persistent or broadcast-scoped Standing UI Rule (e.g., "Add graphics buttons here during sermon"), OR
 * 2. Generate/modify a typed JSON UiScreenSpec on a target screen (e.g., "Build a PTZ + Tally workspace on screen-2"
 *    or "Show preflight setup checklist").
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
    durability?: "persistent" | "broadcast" | undefined;
  }): Promise<PromptExecutionResult> {
    const promptText = input.prompt.trim();
    const targetScreenId = this.state.resolveScreenId(input.targetScreenId ?? "screen-1");
    const ctx = this.state.getContext();

    // Try Ollama structured JSON compilation first, falling back to deterministic compiler
    const llmResult = await this.tryOllamaCompile(promptText, targetScreenId, input.durability, ctx);
    if (llmResult) {
      this.emitTurn(targetScreenId, promptText, llmResult.summary);
      return llmResult;
    }

    const compiled = this.compileDeterministically(
      promptText,
      targetScreenId,
      input.durability ?? "persistent",
      ctx
    );
    this.emitTurn(targetScreenId, promptText, compiled.summary);
    return compiled;
  }

  private emitTurn(targetScreenId: string, prompt: string, summary: string): void {
    this.eventBroker?.emit({
      type: "agent-turn",
      data: {
        agentId: "prompted-creator-agent",
        trigger: `prompt:${prompt}`,
        targetScreenId,
        summary,
        time: new Date().toISOString(),
      },
    });
  }

  private async tryOllamaCompile(
    promptText: string,
    targetScreenId: string,
    durability: "persistent" | "broadcast" | undefined,
    ctx: BroadcastContextState
  ): Promise<PromptExecutionResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const system = `You are the Prompted UI Creator Agent ("ui-prompt-creator") in picomposer.
You are NOT the broadcast director — you never switch cameras or issue shot advisories.
You generate typed JSON UI specifications or Standing UI Rules using @piecosystem/piui layout primitives (panel, division, hover) and molecules (graphics-lower-third-panel, preflight-checklist-card, atem-bus-selector, ptz-pad, ptz-preset-card, tally-facet-widget, cue-button-group, audio-fader, rundown-item-card, stream-status-card, live-captions-feed, steering-notes-list, decision-log-list).
Respond ONLY with valid JSON:
{
  "intent": "standing_rule" | "screen_layout",
  "summary": "Human readable explanation",
  "rule": { ...StandingUiRuleCreate... }, // when intent === "standing_rule"
  "screen": { ...UiScreenSpec... } // when intent === "screen_layout"
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
                broadcastContext: ctx,
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
        };
      }

      if (parsed.intent === "screen_layout" && parsed.screen) {
        const validatedScreen = UiScreenSpecSchema.parse({
          ...parsed.screen,
          screenId: targetScreenId,
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
    ctx: BroadcastContextState
  ): PromptExecutionResult {
    const lower = promptText.toLowerCase();

    // Detect if the prompt is a conditional / standing rule request
    // e.g. "Add graphics buttons here during sermon", "when in communion...", "always during prayer..."
    const isStandingRequest =
      /\b(during|when|whenever|always|every\s+time|standing)\b/i.test(promptText);

    if (isStandingRequest) {
      let section: string | null = null;
      if (lower.includes("sermon") || lower.includes("saarna")) {
        section = "sermon";
      } else if (lower.includes("prayer") || lower.includes("rukous") || lower.includes("intercession")) {
        section = "intercession";
      } else if (lower.includes("communion") || lower.includes("ehtoollinen")) {
        section = "communion";
      } else if (lower.includes("hymn") || lower.includes("virsi") || lower.includes("intro")) {
        section = "intro";
      }

      const wantsHover = lower.includes("hover") || lower.includes("overlay") || lower.includes("popover");
      const wantsGraphics =
        lower.includes("graphic") || lower.includes("lower third") || lower.includes("alanimi") || lower.includes("title");

      const ruleName = wantsGraphics
        ? `Graphics Controls (${section ? `during ${section}` : "Standing"})`
        : `Custom Controls (${section ? `during ${section}` : "Standing"})`;

      const panel: UiPanelNode = wantsGraphics
        ? {
            type: "panel",
            id: `panel-rule-graphics-${section ?? "live"}`,
            title: "Lower-Third Graphics & Titles",
            subtitle: section ? `Auto-mounted during ${section}` : "Standing UI Rule",
            icon: "subtitles",
            tone: "standing-rule",
            zone: "main",
            sourceLabel: `Standing Rule: ${section ?? "always"}`,
            collapsible: false,
            collapsed: false,
            pinned: true,
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
        summary: `Registered standing UI rule '${createdRule.name}' on ${targetScreenId}${section ? ` (trigger: section=${section})` : ""}`,
        rule: createdRule,
        screen: updatedScreen,
      };
    }

    // Immediate on-demand screen layout generation (e.g. preflight, camera/tally workspace, graphics, audio)
    const slot = this.state.ensureScreen(targetScreenId, {
      managedBy: "prompted-creator-agent",
    });

    const panels: UiPanelNode[] = [];

    if (lower.includes("preflight") || lower.includes("setup") || lower.includes("check")) {
      const preflightSpec = this.reactiveAgent.composeScreen("screen-3", `prompt:${promptText}`);
      const cloned: UiScreenSpec = {
        ...preflightSpec,
        screenId: slot.screenId,
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
    const screenSpec: UiScreenSpec = {
      screenId: slot.screenId,
      screenName: slot.screenName,
      role: slot.role,
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
          direction: "grid",
          columns: panels.length > 1 ? 2 : 1,
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
    };
  }
}
