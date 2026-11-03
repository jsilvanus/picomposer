import type { ContextReactiveUiAgent } from "../agents/context-reactive-agent.js";
import type { StandingRulesStore } from "../rules/standing-rules-store.js";
import type { ComposerState } from "../state/composer-state.js";

export interface EcosystemIngestorOptions {
  state: ComposerState;
  rulesStore: StandingRulesStore;
  reactiveAgent: ContextReactiveUiAgent;
}

export class EcosystemIngestor {
  private readonly state: ComposerState;
  private readonly rulesStore: StandingRulesStore;
  private readonly reactiveAgent: ContextReactiveUiAgent;

  constructor(options: EcosystemIngestorOptions) {
    this.state = options.state;
    this.rulesStore = options.rulesStore;
    this.reactiveAgent = options.reactiveAgent;
  }

  /**
   * Handles an incoming event from pidirector, pirundown, pitube, or pigateway
   * and triggers ContextReactiveUiAgent to recompose affected screens.
   */
  handleEvent(type: string, data: Record<string, any>): void {
    switch (type) {
      case "advisory": {
        this.state.updateDirector({
          mode: "advisory",
          pendingAdvisory: data,
        });
        this.reactiveAgent.composeAll(`director_advisory:${data?.["id"] ?? "new"}`);
        break;
      }

      case "decision":
      case "executed": {
        this.state.updateDirector({
          lastDecision: data,
          pendingAdvisory: null,
        });
        if (typeof data?.["decision"]?.["cutToInput"] === "number") {
          this.state.updateHardware({
            programInput: data["decision"]["cutToInput"],
          });
        }
        this.reactiveAgent.composeAll(`director_${type}`);
        break;
      }

      case "mode-changed": {
        this.state.updateDirector({
          mode: data?.["mode"],
          lastActiveMode: data?.["previousMode"],
        });
        this.reactiveAgent.composeAll(`director_mode:${data?.["mode"]}`);
        break;
      }

      case "preempted": {
        this.state.updateDirector({
          mode: data?.["newMode"] ?? "manual",
          lastActiveMode: data?.["previousMode"] ?? "autonomous",
          pendingAdvisory: null,
          lastOperatorAction: {
            actor: data?.["actor"] ?? "operator",
            action: "preempt",
            reason: data?.["reason"],
            timestamp: data?.["time"] ?? new Date().toISOString(),
          },
        });
        this.reactiveAgent.composeAll(`operator_preempt:${data?.["actor"] ?? "operator"}`);
        break;
      }

      case "action": {
        const actor = String(data?.["actor"] ?? "operator");
        const actionName = String(data?.["action"] ?? "manual_action");
        if (actor !== "pidirector" && actor !== "pirundown") {
          this.state.updateDirector({
            mode: "manual",
            pendingAdvisory: null,
            lastOperatorAction: {
              actor,
              action: actionName,
              targetCamera: data?.["params"]?.["camera"] ?? data?.["camera"],
              targetInput: data?.["params"]?.["input"] ?? data?.["input"],
              timestamp: new Date().toISOString(),
            },
          });
          if (typeof data?.["params"]?.["input"] === "number") {
            this.state.updateHardware({ programInput: data["params"]["input"] });
          }
          this.reactiveAgent.composeAll(`operator_action:${actionName}`);
        }
        break;
      }

      case "steering-updated": {
        this.state.updateDirector({
          steering: data,
        });
        this.reactiveAgent.composeAll("steering_updated");
        break;
      }

      case "rundown":
      case "rundown_state":
      case "cue:triggered": {
        this.state.updateRundown(data ?? {});
        const cueLabel =
          data?.["currentSection"] ??
          data?.["section"] ??
          data?.["currentCueId"] ??
          data?.["cueId"] ??
          "update";
        this.reactiveAgent.composeAll(`rundown:${cueLabel}`);
        break;
      }

      case "pitube":
      case "youtube":
      case "broadcast-updated": {
        this.state.updatePitube(data ?? {});
        if (this.state.getContext().pitube.state === "complete") {
          this.rulesStore.clearBroadcastScopedRules();
        }
        this.reactiveAgent.composeAll(`pitube:${this.state.getContext().pitube.state}`);
        break;
      }

      case "broadcast-dumped": {
        this.rulesStore.clearBroadcastScopedRules();
        this.reactiveAgent.composeAll("broadcast_dumped");
        break;
      }

      case "atem": {
        this.state.updateHardware({
          atemConnected: data?.["connected"],
          programInput: data?.["programInput"],
          previewInput: data?.["previewInput"],
          dwellSec: data?.["dwellSec"],
        });
        this.reactiveAgent.composeAll("atem_updated");
        break;
      }

      case "transcript": {
        if (typeof data?.["text"] === "string" && data["text"]) {
          this.state.ingestTranscript(data["text"], data["timestamp"]);
          this.reactiveAgent.composeAll("transcript_updated");
        }
        break;
      }

      case "pivoice":
      case "pisound": {
        this.state.updateHardware({
          voiceActive: data?.["voiceActive"] ?? data?.["isSpeaking"],
          audioClassification: data?.["classification"],
        });
        this.reactiveAgent.composeAll("audio_updated");
        break;
      }
    }
  }
}
