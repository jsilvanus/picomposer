import * as piui from "@piecosystem/piui";
import {
  COMPOSER_COMPONENT_KINDS,
  PIUI_ATOM_KINDS,
  PIUI_MOLECULE_KINDS,
  type UiComponentKind,
} from "../schema/ui-schema.js";

export type CatalogLayer = "atom" | "molecule" | "composer";

export interface CatalogEntry {
  kind: UiComponentKind;
  layer: CatalogLayer;
  /** Name of the @piecosystem/piui render function backing this kind (atoms & molecules). */
  piuiFunction?: string | undefined;
  description: string;
  /** Whether this kind can carry clickable action bindings (targets). */
  actionable: boolean;
}

type RenderFn = (props: Record<string, unknown>) => string;

function toPascal(kind: string): string {
  return kind
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

const DESCRIPTIONS: Partial<Record<UiComponentKind, string>> = {
  icon: "Material symbol icon ({ name, size })",
  "status-dot": "Coloured status dot ({ status: online|live|warning|error|busy|offline, pulse })",
  badge: "Label pill ({ label, variant, dot, pulse, icon })",
  button: "Clickable button; bind actions/targets to drive any Pi hardware ({ label, variant, icon })",
  card: "Generic card container ({ title, subtitle, icon, content })",
  slider: "Range slider ({ id, min, max, value, label, unit })",
  "toggle-switch": "Segmented selector ({ options: [{value,label}], selectedValue })",
  "stat-display": "Key figure ({ label, value, size })",
  meter: "VU / level meter ({ value, min, max, label })",
  "text-input": "Text input ({ id, placeholder, value })",
  "speaker-badge": "Role-coded speaker tag ({ role, name, hasName })",
  "agent-status-badge": "AI agent run state ({ status })",
  "agent-priority-pill": "Agent priority ({ priority })",
  "model-badge": "LLM model tag ({ model })",
  "caption-item": "Single caption line with delivery flags",
  "live-captions-feed": "Live captions feed bound to pivoice; props.sentOnly shows only captions sent to YouTube/relay",
  "stream-status-card": "pitube broadcast status",
  "encoder-monitor": "Matrox encoder monitor",
  "audio-fader": "pisound channel fader ({ id, name, volumePercent, isMuted })",
  "ptz-pad": "PTZ joystick pad ({ camera })",
  "ptz-preset-card": "PTZ preset grid ({ camera, presets })",
  "cue-button-group": "Tally operator cue buttons ({ targetLightId, targetLightName })",
  "tally-facet-widget": "Tally-Ma 9-zone light widget",
  "atem-bus-selector": "ATEM program/preview bus ({ programInput, previewInput })",
  "matrix-route-row": "Atlona matrix crosspoint row",
  "routing-output-card": "pimatrix HDMI output routing card",
  "radio-player-card": "Web radio relay player",
  "slide-feed-card": "piprogram slide feed",
  "ecosystem-health-card": "Service health overview",
  "cue-trigger-badge": "Rundown cue trigger badge",
  "rundown-item-card": "Rundown item card",
  "agent-card": "piagent agent card",
  "agent-chat-bubble": "Agent chat bubble",
  "agent-tool-invocation-card": "Agent tool call card",
  "agent-control-toolbar": "Agent control toolbar",
  "director-advisory-card": "pidirector advisory summary",
  "director-active-shot-card": "Autonomous director active shot",
  "manual-override-card": "Manual operator override summary",
  "graphics-lower-third-panel": "Lower-third preview bound to rundown speaker/cue",
  "preflight-checklist-card": "Broadcast preflight checklist",
  "wireless-mic-bank": "Bank of wireless mic strips ({ channels })",
  "steering-notes-list": "Director steering notes",
  "decision-log-list": "Director decision log",
  "action-button-group": "Group of action buttons (use actions with targets)",
  "macro-button": "Multi-step macro button ({ label, steps })",
  "timer-display": "Set-time or rundown timer ({ mode, scope, setDurationSec })",
  "timeseries-chart": "Live telemetry chart ({ metric })",
  "stat-grid": "Grid of key figures ({ stats: [{label,value}] })",
};

const ACTIONABLE = new Set<UiComponentKind>([
  "button",
  "card",
  "audio-fader",
  "ptz-pad",
  "ptz-preset-card",
  "cue-button-group",
  "atem-bus-selector",
  "action-button-group",
  "macro-button",
  "graphics-lower-third-panel",
  "wireless-mic-bank",
]);

function resolvePiuiRenderer(kind: string): RenderFn | undefined {
  const name = `render${toPascal(kind)}`;
  const fn = (piui as unknown as Record<string, unknown>)[name];
  return typeof fn === "function" ? (fn as RenderFn) : undefined;
}

export function buildComponentCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const kind of PIUI_ATOM_KINDS) {
    entries.push({
      kind,
      layer: "atom",
      piuiFunction: `render${toPascal(kind)}`,
      description: DESCRIPTIONS[kind] ?? kind,
      actionable: ACTIONABLE.has(kind),
    });
  }
  for (const kind of PIUI_MOLECULE_KINDS) {
    entries.push({
      kind,
      layer: "molecule",
      piuiFunction: `render${toPascal(kind)}`,
      description: DESCRIPTIONS[kind] ?? kind,
      actionable: ACTIONABLE.has(kind),
    });
  }
  for (const kind of COMPOSER_COMPONENT_KINDS) {
    entries.push({
      kind,
      layer: "composer",
      description: DESCRIPTIONS[kind] ?? kind,
      actionable: ACTIONABLE.has(kind),
    });
  }
  return entries;
}

/**
 * Renders any @piecosystem/piui atom or molecule by kind. Returns null when the kind is not backed
 * by a piui function or the props are incompatible, so callers can fall back to a generic view.
 */
export function renderPiuiComponent(kind: string, props: Record<string, unknown>): string | null {
  const fn = resolvePiuiRenderer(kind);
  if (!fn) return null;
  try {
    const html = fn(props);
    return typeof html === "string" ? html : null;
  } catch {
    return null;
  }
}

/** Returns the piui kinds whose render function is missing (should be empty). */
export function findMissingPiuiRenderers(): string[] {
  return [...PIUI_ATOM_KINDS, ...PIUI_MOLECULE_KINDS].filter((k) => !resolvePiuiRenderer(k));
}
