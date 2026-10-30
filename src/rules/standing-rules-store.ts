import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ComposerEventBroker } from "../events.js";
import {
  StandingUiRuleCreateSchema,
  type StandingUiRule,
  type StandingUiRuleCreate,
} from "../schema/ui-schema.js";
import {
  evaluateVisibilityCondition,
  matchesSectionOrTopic,
  type BroadcastContextState,
} from "../state/composer-state.js";

export interface StandingRulesStoreOptions {
  filePath?: string | undefined;
  eventBroker?: ComposerEventBroker | undefined;
}

export class StandingRulesStore {
  private readonly filePath: string;
  private readonly eventBroker?: ComposerEventBroker | undefined;
  private readonly rules: StandingUiRule[] = [];
  private seq = 1;

  constructor(options: StandingRulesStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? "data/standing-rules.json");
    this.eventBroker = options.eventBroker;
    this.loadFromDisk();
  }

  getAll(): StandingUiRule[] {
    return this.rules.map((r) => structuredClone(r));
  }

  getById(id: string): StandingUiRule | null {
    const found = this.rules.find((r) => r.id === id);
    return found ? structuredClone(found) : null;
  }

  /**
   * Evaluates all enabled standing UI rules against the current BroadcastContextState
   * and target screenId.
   */
  getMatchingRules(context: BroadcastContextState, screenId: string): StandingUiRule[] {
    return this.rules
      .filter((rule) => {
        if (!rule.enabled) return false;
        if (rule.targetScreenId !== "*" && rule.targetScreenId !== screenId) {
          return false;
        }

        const t = rule.trigger;
        if (t.phase !== "always" && t.phase !== context.phase) {
          return false;
        }

        const conditionOperator = t.conditionOperator ?? "during";
        if (t.section || t.subsection || t.cueId) {
          const matchesCond = evaluateVisibilityCondition(
            {
              operator: conditionOperator,
              section: t.section,
              subsection: t.subsection,
              cueId: t.cueId,
              phase: t.phase,
            },
            context
          );
          if (!matchesCond) return false;
        }

        if (t.subsection && conditionOperator === "during") {
          const targetSub = t.subsection;
          const matchesSub =
            matchesSectionOrTopic(context.rundown.currentSubsection, targetSub) ||
            matchesSectionOrTopic(context.rundown.currentCueId, targetSub) ||
            matchesSectionOrTopic(context.rundown.currentCueTitle, targetSub);
          if (!matchesSub) return false;
        }

        if (t.cueId && conditionOperator === "during") {
          const targetCue = t.cueId;
          if (!matchesSectionOrTopic(context.rundown.currentCueId, targetCue)) {
            return false;
          }
        }

        if (t.directorState && t.directorState !== "any") {
          const isAdvising =
            context.director.mode === "advisory" && context.director.pendingAdvisory !== null;
          const isDirecting = context.director.mode === "autonomous";
          const isManual = context.director.mode === "manual";
          if (t.directorState === "advising" && !isAdvising) return false;
          if (t.directorState === "directing" && !isDirecting) return false;
          if (t.directorState === "manual" && !isManual) return false;
        }

        if (t.audioClassification && t.audioClassification !== "any") {
          if (context.hardware.audioClassification !== t.audioClassification) {
            return false;
          }
        }

        return true;
      })
      .map((r) => structuredClone(r));
  }

  addRule(input: StandingUiRuleCreate): StandingUiRule {
    const parsed = StandingUiRuleCreateSchema.parse(input);
    const now = new Date().toISOString();
    const id = parsed.id ?? `rule_${this.seq++}`;

    const existingIdx = this.rules.findIndex((r) => r.id === id);
    const rule: StandingUiRule = {
      id,
      name: parsed.name,
      description: parsed.description ?? parsed.name,
      promptText: parsed.promptText ?? null,
      targetScreenId: parsed.targetScreenId,
      targetZone: parsed.targetZone,
      container: parsed.container,
      durability: parsed.durability,
      enabled: parsed.enabled,
      createdAt: existingIdx >= 0 ? this.rules[existingIdx]!.createdAt : now,
      updatedAt: now,
      trigger: parsed.trigger,
      panel: parsed.panel,
      hover: parsed.hover,
    };

    if (existingIdx >= 0) {
      this.rules[existingIdx] = rule;
    } else {
      this.rules.push(rule);
    }

    this.saveToDisk();
    this.eventBroker?.emit({
      type: "standing-rules-updated",
      data: { rules: this.getAll() },
    });
    return structuredClone(rule);
  }

  toggleRule(id: string, enabled?: boolean): StandingUiRule | null {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return null;
    rule.enabled = enabled !== undefined ? enabled : !rule.enabled;
    rule.updatedAt = new Date().toISOString();
    this.saveToDisk();
    this.eventBroker?.emit({
      type: "standing-rules-updated",
      data: { rules: this.getAll() },
    });
    return structuredClone(rule);
  }

  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    this.saveToDisk();
    this.eventBroker?.emit({
      type: "standing-rules-updated",
      data: { rules: this.getAll() },
    });
    return true;
  }

  clearBroadcastScopedRules(): number {
    const before = this.rules.length;
    const kept = this.rules.filter((r) => r.durability === "persistent");
    const removed = before - kept.length;
    if (removed > 0) {
      this.rules.length = 0;
      this.rules.push(...kept);
      this.saveToDisk();
      this.eventBroker?.emit({
        type: "standing-rules-updated",
        data: { rules: this.getAll() },
      });
    }
    return removed;
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.id === "string" && typeof item.name === "string") {
            this.rules.push(item as StandingUiRule);
            const num = Number.parseInt(item.id.replace(/^rule_/, ""), 10);
            if (!Number.isNaN(num) && num >= this.seq) {
              this.seq = num + 1;
            }
          }
        }
      }
    } catch {
      // Ignore corrupt disk state
    }
  }

  private saveToDisk(): void {
    try {
      const persistentOnly = this.rules.filter((r) => r.durability === "persistent");
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(persistentOnly, null, 2), "utf8");
    } catch {
      // Non-fatal in read-only test envs
    }
  }
}
