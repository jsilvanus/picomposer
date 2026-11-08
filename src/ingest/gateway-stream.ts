import type { EcosystemIngestor } from "./ecosystem-ingestor.js";

/** Gateway event types picomposer reacts to (the stream is filtered with ?types=). */
export const GATEWAY_EVENT_TYPES = ["atem", "rundown", "pivoice", "transcript"] as const;

export interface SseMessage {
  event: string;
  data: string;
}

/** Incremental SSE parser: feed chunks, get complete messages back. Comments (": keep-alive") are dropped. */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const out: SseMessage[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) out.push({ event, data: data.join("\n") });
    }
    return out;
  }
}

/** Translate one pigateway event into what the ingestor understands. Returns null for events we ignore. */
export function mapGatewayEvent(type: string, data: any): { type: string; data: Record<string, any> } | null {
  if (!data || typeof data !== "object") return null;
  switch (type) {
    case "atem":
      return { type: "atem", data };
    case "rundown": {
      if (data.loaded === false) return null;
      const item = data.currentItem;
      return {
        type: "rundown",
        data: {
          currentSection: item?.section ?? item?.title ?? null,
          currentCueId: item?.id ?? null,
          currentCueTitle: item?.title ?? null,
        },
      };
    }
    case "pivoice":
      return {
        type: "pivoice",
        data: { voiceActive: data.classification === "speech", classification: data.classification },
      };
    case "transcript":
      return typeof data.text === "string"
        ? {
            type: "transcript",
            data: {
              text: data.text,
              timestamp: typeof data.endedAt === "number" ? new Date(data.endedAt).toISOString() : undefined,
            },
          }
        : null;
    default:
      return null;
  }
}

export interface GatewayStreamOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  ingestor: EcosystemIngestor;
  fetchFn?: typeof fetch | undefined;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  log?: (msg: string) => void;
}

/** Subscribes to pigateway's /api/v1/events and feeds the ingestor; reconnects with backoff. */
export class GatewayStream {
  private readonly opts: Required<Pick<GatewayStreamOptions, "minBackoffMs" | "maxBackoffMs">> & GatewayStreamOptions;
  private controller: AbortController | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private backoff: number;

  constructor(options: GatewayStreamOptions) {
    this.opts = { minBackoffMs: 1000, maxBackoffMs: 30000, ...options };
    this.backoff = this.opts.minBackoffMs;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async connect(): Promise<void> {
    const { baseUrl, apiKey, ingestor, log = () => {} } = this.opts;
    const fetchFn = this.opts.fetchFn ?? globalThis.fetch;
    this.controller = new AbortController();
    try {
      const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/events?types=${GATEWAY_EVENT_TYPES.join(",")}&client=picomposer`;
      const res = await fetchFn(url, {
        headers: { accept: "text/event-stream", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        signal: this.controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      log("gateway stream connected");
      this.backoff = this.opts.minBackoffMs;
      const parser = new SseParser();
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        for (const msg of parser.push(decoder.decode(chunk, { stream: true }))) {
          this.dispatch(msg);
        }
      }
      throw new Error("stream ended");
    } catch (err) {
      if (this.stopped) return;
      log(`gateway stream: ${err instanceof Error ? err.message : String(err)}; retry in ${this.backoff} ms`);
      this.timer = setTimeout(() => void this.connect(), this.backoff);
      this.timer.unref();
      this.backoff = Math.min(this.opts.maxBackoffMs, this.backoff * 2);
    }
  }

  private dispatch(msg: SseMessage): void {
    let data: unknown;
    try {
      data = JSON.parse(msg.data);
    } catch {
      return;
    }
    const mapped = mapGatewayEvent(msg.event, data);
    if (mapped) this.opts.ingestor.handleEvent(mapped.type, mapped.data);
  }
}
