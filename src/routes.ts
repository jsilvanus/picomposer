import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ContextReactiveUiAgent } from "./agents/context-reactive-agent.js";
import type { PromptedUiCreatorAgent } from "./agents/prompted-creator-agent.js";
import type { ComposerEventBroker } from "./events.js";
import { renderGuiPageHtml } from "./gui/render-gui.js";
import { buildComponentCatalog } from "./catalog/component-catalog.js";
import type { EcosystemIngestor } from "./ingest/ecosystem-ingestor.js";
import type { StandingRulesStore } from "./rules/standing-rules-store.js";
import {
  RundownActionItemSchema,
  StandingUiRuleCreateSchema,
  TimeSeriesMetricSchema,
  UiScreenRectSchema,
} from "./schema/ui-schema.js";
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

  function serveGuiView(name: string | undefined, number: string | undefined, reply: FastifyReply) {
    const slot = state.ensurePageView(name ?? "1", number ?? "1");
    if (!slot.spec) {
      if (slot.managedBy === "context-reactive-agent") {
        reactiveAgent.composeScreen(slot.screenId, "initial_gui_load");
      } else {
        reactiveAgent.composeDefaultOperatorWorkspace(slot.screenId, "initial_gui_load");
      }
    }
    const spec = state.getScreen(slot.screenId)!.spec!;
    const html = renderGuiPageHtml({
      spec,
      context: state.getContext(),
      mouseContext: state.getMouseContext(),
      lastMessageContext: state.getLastMessageContext(),
      pages: state.listPages(),
      savedComponentNames: state.savedComponentsStore.list().map((c) => c.name),
    });
    return reply.type("text/html; charset=utf-8").send(html);
  }

  // Multi-screen generative UI routes: /gui, /gui/:name, /gui/:name/:number (with :name default to 1, :number default to 1)
  app.get("/gui", async (_request, reply) => serveGuiView("1", "1", reply));
  app.get<{ Params: { name: string } }>("/gui/:name", async (request, reply) =>
    serveGuiView(request.params.name, "1", reply)
  );
  app.get<{ Params: { name: string; number: string } }>(
    "/gui/:name/:number",
    async (request, reply) => serveGuiView(request.params.name, request.params.number, reply)
  );

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "picomposer",
      phase: state.getContext().phase,
      screensCount: state.listScreens().length,
      pagesCount: state.listPages().length,
      standingRulesCount: rulesStore.getAll().length,
      savedComponentsCount: state.savedComponentsStore.list().length,
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
          role: "On-demand UI workspace builder and standing-rule author prompted by the operator. Knows full broadcast state, mouse context, last message context, and @piecosystem/piui catalog, but is NOT the broadcast director.",
          isBroadcastDirector: false,
          managedScreens: ["screen-2 (operator)", "custom named pages & views", "standing UI rules"],
        },
      ],
    };
  });

  app.get("/api/v1/status", async () => {
    return {
      service: "picomposer",
      context: state.getContext(),
      mouseContext: state.getMouseContext(),
      lastMessageContext: state.getLastMessageContext(),
      standingRules: rulesStore.getAll(),
      savedComponents: state.savedComponentsStore.list(),
      pages: state.listPages(),
      screens: state.listScreens(),
    };
  });

  app.get("/api/v1/pages", async () => {
    return {
      pages: state.listPages(),
    };
  });

  app.get<{ Params: { name: string; number: string } }>(
    "/api/v1/pages/:name/:number",
    async (request) => {
      const slot = state.ensurePageView(request.params.name, request.params.number);
      if (!slot.spec) {
        if (slot.managedBy === "context-reactive-agent") {
          reactiveAgent.composeScreen(slot.screenId, "page_view_load");
        } else {
          reactiveAgent.composeDefaultOperatorWorkspace(slot.screenId, "page_view_load");
        }
      }
      return {
        pageName: slot.pageName,
        viewNumber: slot.viewNumber,
        screen: state.getScreen(slot.screenId),
      };
    }
  );

  // Mouse Selection Context endpoints (for /gui/:name/:number and picomposer-mcp)
  app.get("/api/v1/context/mouse", async () => {
    return {
      mouseContext: state.getMouseContext(),
    };
  });

  app.post("/api/v1/context/mouse", async (request, reply) => {
    const schema = z.object({
      mode: z.enum(["none", "component", "rectangle"]),
      pageName: z.string().optional(),
      viewNumber: z.number().int().min(1).optional(),
      componentId: z.string().optional(),
      componentType: z.string().optional(),
      panelId: z.string().optional(),
      label: z.string().optional(),
      rect: UiScreenRectSchema.optional(),
      overlappingComponentIds: z.array(z.string()).optional(),
      overlappingPanelIds: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid mouse context payload",
        details: parsed.error.format(),
      });
    }
    const updated = state.setMouseContext(parsed.data);
    return {
      ok: true,
      mouseContext: updated,
    };
  });

  app.delete("/api/v1/context/mouse", async () => {
    const cleared = state.clearMouseContext();
    return {
      ok: true,
      mouseContext: cleared,
    };
  });

  app.get("/api/v1/context/last-message", async () => {
    return {
      lastMessageContext: state.getLastMessageContext(),
    };
  });

  app.get("/api/v1/context/broadcast", async () => {
    return {
      broadcastContext: state.getContext(),
    };
  });

  // Saved Named UI Components
  app.get("/api/v1/components/saved", async () => {
    return {
      components: state.savedComponentsStore.list(),
    };
  });

  app.delete<{ Params: { slug: string } }>("/api/v1/components/saved/:slug", async (request, reply) => {
    const ok = state.savedComponentsStore.remove(request.params.slug);
    if (!ok) {
      return reply.code(404).send({ error: `Saved component '${request.params.slug}' not found` });
    }
    return { ok: true };
  });

  // Time-series Telemetry
  app.get("/api/v1/timeseries", async () => {
    return {
      series: state.timeSeriesStore.listAll(),
    };
  });

  app.get<{ Params: { metric: string }; Querystring: { windowSec?: string } }>(
    "/api/v1/timeseries/:metric",
    async (request, reply) => {
      const parsedMetric = TimeSeriesMetricSchema.safeParse(request.params.metric);
      if (!parsedMetric.success) {
        return reply.code(400).send({ error: `Unknown metric '${request.params.metric}'` });
      }
      const windowSec = request.query.windowSec ? Number(request.query.windowSec) : undefined;
      return {
        series: state.timeSeriesStore.getSeries(parsedMetric.data, windowSec),
      };
    }
  );

  app.post<{ Params: { metric: string } }>("/api/v1/timeseries/:metric", async (request, reply) => {
    const parsedMetric = TimeSeriesMetricSchema.safeParse(request.params.metric);
    if (!parsedMetric.success) {
      return reply.code(400).send({ error: `Unknown metric '${request.params.metric}'` });
    }
    const body = (request.body ?? {}) as { value?: number; ts?: string };
    if (typeof body.value !== "number") {
      return reply.code(400).send({ error: "Numeric 'value' is required" });
    }
    const pt = state.timeSeriesStore.record(parsedMetric.data, body.value, body.ts);
    return { ok: true, point: pt };
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
      pageName: z.string().optional(),
      viewNumber: z.number().int().min(1).optional(),
      durability: z.enum(["persistent", "broadcast"]).optional(),
      useBroadcastContext: z.boolean().optional(),
      useMouseContext: z.boolean().optional(),
      useLastMessageContext: z.boolean().optional(),
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

  app.get("/api/v1/catalog/components", async () => {
    return {
      catalog: buildComponentCatalog(),
    };
  });

  app.post("/api/v1/actions/dispatch", async (request, reply) => {
    const schema = z.object({
      targets: z.array(RundownActionItemSchema),
      actionId: z.string().optional(),
      source: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid dispatch payload",
        details: parsed.error.format(),
      });
    }

    eventBroker.emit({
      type: "action-dispatched",
      data: {
        targets: parsed.data.targets,
        source: parsed.data.source ?? "api",
      },
    });

    return {
      ok: true,
      executedCount: parsed.data.targets.length,
      targets: parsed.data.targets,
    };
  });

  app.post("/api/v1/transcript", async (request, reply) => {
    const schema = z.object({
      text: z.string().min(1),
      timestamp: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid transcript payload",
        details: parsed.error.format(),
      });
    }

    state.ingestTranscript(parsed.data.text, parsed.data.timestamp);
    reactiveAgent.composeAll("transcript_updated");

    return {
      ok: true,
      text: parsed.data.text,
      matchingRulesCount: rulesStore.getMatchingRules(state.getContext(), "*").length,
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
