import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

export * from "./schema/ui-schema.js";
export * from "./state/composer-state.js";
export * from "./rules/standing-rules-store.js";
export * from "./agents/context-reactive-agent.js";
export * from "./agents/prompted-creator-agent.js";
export * from "./app.js";
export * from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(`picomposer listening on http://${config.host}:${config.port}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting picomposer:", err);
    process.exit(1);
  });
}
