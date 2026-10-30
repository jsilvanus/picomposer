import { EventEmitter } from "node:events";
import type { MouseSelectionContext, StandingUiRule, UiScreenSpec } from "./schema/ui-schema.js";

export type ComposerEvent =
  | { type: "ready"; data: { status: string; screens: string[]; time: string } }
  | { type: "screen-updated"; data: UiScreenSpec }
  | { type: "standing-rules-updated"; data: { rules: StandingUiRule[] } }
  | { type: "context-updated"; data: { mouseContext: MouseSelectionContext } }
  | {
      type: "agent-turn";
      data: {
        agentId: "context-reactive-agent" | "prompted-creator-agent";
        trigger: string;
        targetScreenId: string;
        summary: string;
        time: string;
      };
    };

export class ComposerEventBroker {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: ComposerEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: ComposerEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }
}
