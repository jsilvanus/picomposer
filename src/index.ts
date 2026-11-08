import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { GatewayStream } from "./ingest/gateway-stream.js";

export * from "./schema/ui-schema.js";
export * from "./state/composer-state.js";
export * from "./state/timeseries-store.js";
export * from "./state/saved-components-store.js";
export * from "./rules/standing-rules-store.js";
export * from "./agents/context-reactive-agent.js";
export * from "./agents/prompted-creator-agent.js";
export * from "./gui/render-gui.js";
export * from "./app.js";
export * from "./config.js";
export * from "./ingest/gateway-stream.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ingestor } = buildApp(config);
  const stream = config.autoConnectSse
    ? new GatewayStream({
        baseUrl: config.pigatewayUrl,
        apiKey: config.pigatewayApiKey,
        ingestor,
        log: (m) => console.log(`picomposer: ${m}`),
      })
    : null;
  if (stream) app.addHook("onClose", async () => stream.stop());
  await app.listen({ host: config.host, port: config.port });
  stream?.start();
  console.log(`picomposer listening on http://${config.host}:${config.port}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error starting picomposer:", err);
    process.exit(1);
  });
}
