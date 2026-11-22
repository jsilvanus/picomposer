export interface ComposerConfig {
  host: string;
  port: number;
  ollamaUrl: string;
  fastModel: string;
  creatorModel: string;
  ollamaTimeoutMs: number;
  /** Ollama keep_alive (PICOMPOSER_OLLAMA_KEEP_ALIVE, default 15m). */
  ollamaKeepAlive: string | number;
  pigatewayUrl: string;
  pidirectorUrl: string;
  pirundownUrl: string;
  pitubeUrl: string;
  standingRulesFile: string;
  autoConnectSse: boolean;
  pigatewayApiKey: string | undefined;
}

/** Ollama `keep_alive` default: keep a model loaded for 15 minutes after its last request. */
export const DEFAULT_OLLAMA_KEEP_ALIVE = "15m";

/**
 * Turn an env/config value into what Ollama accepts: a duration string ("15m") or a number of
 * seconds (-1 = forever, 0 = unload at once). Empty/undefined gives the 15 minute default.
 */
export function normalizeKeepAlive(value: string | number | undefined | null): string | number {
  if (value === undefined || value === null) return DEFAULT_OLLAMA_KEEP_ALIVE;
  if (typeof value === "number") return value;
  const v = value.trim();
  if (!v) return DEFAULT_OLLAMA_KEEP_ALIVE;
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ComposerConfig {
  const port = Number.parseInt(env["PICOMPOSER_PORT"] ?? "3402", 10);
  const host = env["PICOMPOSER_HOST"] ?? "0.0.0.0";

  const ollamaUrl = (env["OLLAMA_URL"] ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const fastModel = env["PICOMPOSER_FAST_MODEL"] ?? "llama3.2:3b";
  const creatorModel = env["PICOMPOSER_CREATOR_MODEL"] ?? "qwen2.5:7b-instruct";
  const ollamaTimeoutMs = Number.parseInt(env["PICOMPOSER_OLLAMA_TIMEOUT_MS"] ?? "1500", 10);

  const ollamaKeepAlive = normalizeKeepAlive(env["PICOMPOSER_OLLAMA_KEEP_ALIVE"] ?? env["OLLAMA_KEEP_ALIVE"]);

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
    ollamaKeepAlive,
    pigatewayUrl,
    pidirectorUrl,
    pirundownUrl,
    pitubeUrl,
    standingRulesFile,
    autoConnectSse,
    pigatewayApiKey: env["PIGATEWAY_API_KEY"]?.trim() || undefined,
  };
}
