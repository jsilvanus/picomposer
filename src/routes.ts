import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ContextReactiveUiAgent } from "./agents/context-reactive-agent.js";
import type { PromptedUiCreatorAgent } from "./agents/prompted-creator-agent.js";
import type { ComposerEventBroker } from "./events.js";
import type { EcosystemIngestor } from "./ingest/ecosystem-ingestor.js";
import type { StandingRulesStore } from "./rules/standing-rules-store.js";
import { StandingUiRuleCreateSchema } from "./schema/ui-schema.js";
import type { ComposerState } from "./state/composer-state.js";

export interface RouteDependencies {
  state: ComposerState;
  rulesStore: StandingRulesStore;
  reactiveAgent: ContextReactiveUiAgent;
  creatorAgent: PromptedUiCreatorAgent;
  ingestor: EcosystemIngestor;
  eventBroker: ComposerEventBroker;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDependencies): void {
  const { state, rulesStore, reactiveAgent, creatorAgent, ingestor, eventBroker } = deps;

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "picomposer",
      phase: state.getContext().phase,
      screensCount: state.listScreens().length,
      standingRulesCount: rulesStore.getAll().length,
      time: new Date().toISOString(),
    };
  });

  app.get("/api/v1/agents", async () => {
    return {
      agents: [
        {
          id: "context-reactive-agent",
          piagentId: "ui-context-composer",
          name: "Broadcast Context UI Composer",
          role: "Proactive/reactive UI composer driven by pidirector advisories, autonomous cuts, operator manual actions, broadcast preflight/live phases, and standing UI rules.",
          isBroadcastDirector: false,
          managedScreens: ["screen-1 (copilot)", "screen-3 (preflight)"],
        },
        {
          id: "prompted-creator-agent",
          piagentId: "ui-prompt-creator",
          name: "Prompted UI & Standing Rules Creator",
          role: "On-demand UI workspace builder and standing-rule author prompted by the operator. Knows full broadcast state and @piecosystem/piui catalog, but is NOT the broadcast director.",
          isBroadcastDirector: false,
          managedScreens: ["screen-2 (operator)", "custom screens", "standing UI rules"],
        },
      ],
    };
  });

  app.get("/api/v1/status", async () => {
    return {
      service: "picomposer",
      context: state.getContext(),
      standingRules: rulesStore.getAll(),
      screens: state.listScreens(),
    };
  });

  app.get("/api/v1/events", (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const sendEvent = (type: string, data: unknown) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify({ type, data })}\n\n`);
    };

    sendEvent("ready", {
      status: "connected",
      screens: state.listScreens().map((s) => s.screenId),
      time: new Date().toISOString(),
    });

    const unsub = eventBroker.subscribe((evt) => {
      sendEvent(evt.type, evt.data);
    });

    request.raw.on("close", () => {
      unsub();
    });
  });

  app.get("/api/v1/screens", async () => {
    reactiveAgent.composeAll("screens_query");
    return {
      screens: state.listScreens(),
    };
  });

  app.get<{ Params: { screenId: string } }>("/api/v1/screens/:screenId", async (request) => {
    const slot = state.ensureScreen(request.params.screenId);
    if (!slot.spec) {
      if (slot.managedBy === "context-reactive-agent") {
        reactiveAgent.composeScreen(slot.screenId, "initial_load");
      } else {
        reactiveAgent.composeDefaultOperatorWorkspace(slot.screenId, "initial_load");
      }
    }
    return {
      screen: state.getScreen(slot.screenId),
    };
  });

  app.post<{ Params: { screenId: string } }>("/api/v1/screens/:screenId/compose", async (request) => {
    const body = (request.body ?? {}) as { reason?: string };
    const spec = reactiveAgent.composeScreen(
      request.params.screenId,
      body.reason ?? "manual_compose"
    );
    return {
      ok: true,
      screen: spec,
    };
  });

  app.post("/api/v1/prompt", async (request, reply) => {
    const schema = z.object({
      prompt: z.string().min(1),
      targetScreenId: z.string().optional(),
      durability: z.enum(["persistent", "broadcast"]).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid prompt payload",
        details: parsed.error.format(),
      });
    }

    const res = await creatorAgent.handlePrompt(parsed.data);
    return res;
  });

  app.get("/api/v1/rules", async () => {
    return {
      rules: rulesStore.getAll(),
    };
  });

  app.post("/api/v1/rules", async (request, reply) => {
    const parsed = StandingUiRuleCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid standing UI rule payload",
        details: parsed.error.format(),
      });
    }
    const rule = rulesStore.addRule(parsed.data);
    reactiveAgent.composeAll(`rule_created:${rule.id}`);
    return {
      ok: true,
      rule,
    };
  });

  app.post<{ Params: { id: string } }>("/api/v1/rules/:id/toggle", async (request, reply) => {
    const body = (request.body ?? {}) as { enabled?: boolean };
    const rule = rulesStore.toggleRule(request.params.id, body.enabled);
    if (!rule) {
      return reply.code(404).send({
        error: `Standing UI rule '${request.params.id}' not found`,
      });
    }
    reactiveAgent.composeAll(`rule_toggled:${rule.id}`);
    return {
      ok: true,
      rule,
    };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/rules/:id", async (request, reply) => {
    const removed = rulesStore.removeRule(request.params.id);
    if (!removed) {
      return reply.code(404).send({
        error: `Standing UI rule '${request.params.id}' not found`,
      });
    }
    reactiveAgent.composeAll(`rule_removed:${request.params.id}`);
    return {
      ok: true,
    };
  });

  app.post("/api/v1/ingest/event", async (request, reply) => {
    const body = (request.body ?? {}) as { type?: string; data?: Record<string, any> };
    if (!body.type || typeof body.type !== "string") {
      return reply.code(400).send({ error: "Event 'type' is required" });
    }
    ingestor.handleEvent(body.type, body.data ?? {});
    return {
      ok: true,
      type: body.type,
    };
  });
}
