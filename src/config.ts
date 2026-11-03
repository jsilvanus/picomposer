export interface ComposerConfig {
  host: string;
  port: number;
  ollamaUrl: string;
  fastModel: string;
  creatorModel: string;
  ollamaTimeoutMs: number;
  pigatewayUrl: string;
  pidirectorUrl: string;
  pirundownUrl: string;
  pitubeUrl: string;
  standingRulesFile: string;
  autoConnectSse: boolean;
  pigatewayApiKey: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ComposerConfig {
  const port = Number.parseInt(env["PICOMPOSER_PORT"] ?? "3402", 10);
  const host = env["PICOMPOSER_HOST"] ?? "0.0.0.0";

  const ollamaUrl = (env["OLLAMA_URL"] ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const fastModel = env["PICOMPOSER_FAST_MODEL"] ?? "llama3.2:3b";
  const creatorModel = env["PICOMPOSER_CREATOR_MODEL"] ?? "qwen2.5:7b-instruct";
  const ollamaTimeoutMs = Number.parseInt(env["PICOMPOSER_OLLAMA_TIMEOUT_MS"] ?? "1500", 10);

  const pigatewayUrl = (env["PIGATEWAY_URL"] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  const pidirectorUrl = (env["PIDIRECTOR_URL"] ?? "http://127.0.0.1:3401").replace(/\/+$/, "");
  const pirundownUrl = (env["PIRUNDOWN_URL"] ?? "http://127.0.0.1:3400").replace(/\/+$/, "");
  const pitubeUrl = (env["PITUBE_URL"] ?? "http://127.0.0.1:3500").replace(/\/+$/, "");

  const standingRulesFile =
    env["PICOMPOSER_RULES_FILE"]?.trim() || "data/standing-rules.json";
  const autoConnectSse = env["PICOMPOSER_AUTO_SSE"] !== "false";

  return {
    host,
    port: Number.isNaN(port) ? 3402 : port,
    ollamaUrl,
    fastModel,
    creatorModel,
    ollamaTimeoutMs: Number.isNaN(ollamaTimeoutMs) ? 1500 : ollamaTimeoutMs,
    pigatewayUrl,
    pidirectorUrl,
    pirundownUrl,
    pitubeUrl,
    standingRulesFile,
    autoConnectSse,
    pigatewayApiKey: env["PIGATEWAY_API_KEY"]?.trim() || undefined,
  };
}
