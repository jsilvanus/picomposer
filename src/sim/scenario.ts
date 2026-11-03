import { z } from "zod";

/**
 * A scenario is a JSONL file: one step per line. Blank lines and lines starting with `#` are ignored.
 *
 *   {"at":5000,"event":"advisory","data":{"id":"a1","cutToInput":2}}
 *   {"at":9000,"prompt":"Camera 2 PTZ controls","screen":"screen-2"}
 *
 * `at` is milliseconds from the start; it only matters in --live mode (offline runs ignore the delays).
 * Events use the same types as POST /api/v1/ingest/event.
 */
export const ScenarioStepSchema = z
  .object({
    at: z.number().int().min(0),
    label: z.string().optional(),
    event: z.string().min(1).optional(),
    data: z.record(z.any()).optional(),
    prompt: z.string().min(1).optional(),
    screen: z.string().optional(),
  })
  .refine((s) => (s.event ? !s.prompt : Boolean(s.prompt)), {
    message: "A step needs exactly one of `event` or `prompt`",
  });

export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export function parseScenario(text: string): ScenarioStep[] {
  const steps: ScenarioStep[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`scenario line ${i + 1}: invalid JSON`);
    }
    const parsed = ScenarioStepSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`scenario line ${i + 1}: ${parsed.error.issues.map((x) => x.message).join("; ")}`);
    }
    steps.push(parsed.data);
  });
  steps.sort((a, b) => a.at - b.at);
  return steps;
}
