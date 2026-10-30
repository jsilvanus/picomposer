import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { ContextReactiveUiAgent } from "./agents/context-reactive-agent.js";
import { PromptedUiCreatorAgent } from "./agents/prompted-creator-agent.js";
import type { ComposerConfig } from "./config.js";
import { ComposerEventBroker } from "./events.js";
import { EcosystemIngestor } from "./ingest/ecosystem-ingestor.js";
import { registerRoutes } from "./routes.js";
import { StandingRulesStore } from "./rules/standing-rules-store.js";
import { ComposerState } from "./state/composer-state.js";

export interface BuildComposerAppOptions {
  fetchFn?: typeof fetch | undefined;
  standingRulesFile?: string | undefined;
}

export interface BuildComposerAppResult {
  app: FastifyInstance;
  state: ComposerState;
  rulesStore: StandingRulesStore;
  reactiveAgent: ContextReactiveUiAgent;
  creatorAgent: PromptedUiCreatorAgent;
  ingestor: EcosystemIngestor;
  eventBroker: ComposerEventBroker;
}

export function buildApp(
  config: ComposerConfig,
  options?: BuildComposerAppOptions
): BuildComposerAppResult {
  const app = Fastify({
    logger: false,
  });

  const eventBroker = new ComposerEventBroker();
  const rulesFile = options?.standingRulesFile ?? config.standingRulesFile;
  const state = new ComposerState(eventBroker, path.dirname(path.resolve(rulesFile)));
  const rulesStore = new StandingRulesStore({
    filePath: rulesFile,
    eventBroker,
  });

  const reactiveAgent = new ContextReactiveUiAgent({
    state,
    rulesStore,
    eventBroker,
  });

  const creatorAgent = new PromptedUiCreatorAgent({
    state,
    rulesStore,
    reactiveAgent,
    ollamaUrl: config.ollamaUrl,
    model: config.creatorModel,
    timeoutMs: config.ollamaTimeoutMs,
    fetchFn: options?.fetchFn,
    eventBroker,
  });

  const ingestor = new EcosystemIngestor({
    state,
    rulesStore,
    reactiveAgent,
  });

  // Compose initial default screens
  reactiveAgent.composeAll("startup");

  registerRoutes(app, {
    state,
    rulesStore,
    reactiveAgent,
    creatorAgent,
    ingestor,
    eventBroker,
  });

  return {
    app,
    state,
    rulesStore,
    reactiveAgent,
    creatorAgent,
    ingestor,
    eventBroker,
  };
}
