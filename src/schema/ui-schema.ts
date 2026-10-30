import { z } from "zod";

export const BroadcastPhaseSchema = z.enum(["preflight", "live", "post"]);
export type BroadcastPhase = z.infer<typeof BroadcastPhaseSchema>;

export const DirectorModeSchema = z.enum(["autonomous", "advisory", "manual"]);
export type DirectorMode = z.infer<typeof DirectorModeSchema>;

export const ScreenRoleSchema = z.enum(["copilot", "operator", "preflight", "custom"]);
export type ScreenRole = z.infer<typeof ScreenRoleSchema>;

export const LayoutModeSchema = z.enum(["grid", "document"]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const TimeSeriesMetricSchema = z.enum([
  "audio_rms_dbfs",
  "caption_lag_ms",
  "shot_dwell_sec",
  "stream_bitrate_kbps",
  "camera_motion_speed",
]);
export type TimeSeriesMetric = z.infer<typeof TimeSeriesMetricSchema>;

export const UiScreenRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type UiScreenRect = z.infer<typeof UiScreenRectSchema>;

/**
 * Conditional visibility for panels and components:
 * e.g. "show only after sermon has passed" -> { operator: "after", section: "sermon" }
 */
export const UiVisibilityConditionSchema = z.object({
  operator: z.enum(["always", "before", "during", "after", "not_during"]).default("always"),
  section: z.string().nullable().optional(),
  subsection: z.string().nullable().optional(),
  cueId: z.string().nullable().optional(),
  phase: z.enum(["preflight", "live", "post", "always"]).optional(),
});
export type UiVisibilityCondition = z.infer<typeof UiVisibilityConditionSchema>;

/**
 * Typed Action Bindings for UI components and multi-step Macros.
 */
export const UiActionTypeSchema = z.enum([
  "director.acceptAdvisory",
  "director.dismissAdvisory",
  "director.preempt",
  "director.continue",
  "director.mode",
  "director.steerNote",
  "director.toggleNote",
  "director.dumpBroadcast",
  "atem.cut",
  "atem.cutInput",
  "atem.preview",
  "atem.auto",
  "atem.ftb",
  "camera.preset",
  "camera.move",
  "graphics.lowerThird",
  "pipgm.blackout",
  "sound.fader",
  "sound.mute",
  "audio.mute",
  "audio.muteAll",
  "pitube.select",
  "pitube.create",
  "pitube.start",
  "pitube.stop",
  "rundown.next",
  "tally.cue",
  "voice.captureStart",
  "macro.execute",
  "dispatch",
]);
export type UiActionType = z.infer<typeof UiActionTypeSchema>;

/**
 * A pirundown ActionItem (object form like `{ cam: { id: 1, preset: 4, cutAfterMoved: true } }`
 * or shorthand string like `"cam:1:preset:4"`). Buttons can bind any number of these as targets,
 * so a single UI primitive can drive cameras, ATEM/DSK, tally, pipgm, variables, fetches, etc.
 */
export const RundownActionItemSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);
export type RundownActionItem = z.infer<typeof RundownActionItemSchema>;

export const UiMacroStepSchema = z.object({
  id: z.string().optional(),
  action: UiActionTypeSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  targets: z.array(RundownActionItemSchema).optional(),
  label: z.string().optional(),
  delayMs: z.number().nonnegative().optional(),
});
export type UiMacroStep = z.infer<typeof UiMacroStepSchema>;

export const UiActionBindingSchema = z.object({
  id: z.string(),
  label: z.string(),
  action: UiActionTypeSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  targets: z.array(RundownActionItemSchema).optional(),
  steps: z.array(UiMacroStepSchema).optional(),
  variant: z
    .enum(["primary", "secondary", "danger", "ghost", "surface-high", "atem-pgm", "atem-pvw"])
    .default("primary"),
  icon: z.string().optional(),
  condition: UiVisibilityConditionSchema.optional(),
  showForSec: z.number().positive().optional(),
  expiresAt: z.string().optional(),
});
export type UiActionBinding = z.infer<typeof UiActionBindingSchema>;
export type UiActionButton = UiActionBinding;

/**
 * Typed PiUI Component Nodes (Atoms & Molecules inside Panels / Divisions / Documents / Hovers).
 * Every atom and molecule exported by @piecosystem/piui is listed here, plus picomposer-native
 * composites (macro-button, timer-display, timeseries-chart, wireless-mic-bank, ...).
 */
export const PIUI_ATOM_KINDS = [
  "icon",
  "status-dot",
  "badge",
  "button",
  "card",
  "slider",
  "toggle-switch",
  "stat-display",
  "meter",
  "text-input",
  "speaker-badge",
  "agent-status-badge",
  "agent-priority-pill",
  "model-badge",
] as const;

export const PIUI_MOLECULE_KINDS = [
  "caption-item",
  "live-captions-feed",
  "stream-status-card",
  "encoder-monitor",
  "audio-fader",
  "ptz-pad",
  "ptz-preset-card",
  "cue-button-group",
  "tally-facet-widget",
  "atem-bus-selector",
  "matrix-route-row",
  "routing-output-card",
  "radio-player-card",
  "slide-feed-card",
  "ecosystem-health-card",
  "cue-trigger-badge",
  "rundown-item-card",
  "agent-card",
  "agent-chat-bubble",
  "agent-tool-invocation-card",
  "agent-control-toolbar",
] as const;

export const COMPOSER_COMPONENT_KINDS = [
  "director-advisory-card",
  "director-active-shot-card",
  "manual-override-card",
  "graphics-lower-third-panel",
  "preflight-checklist-card",
  "wireless-mic-bank",
  "steering-notes-list",
  "decision-log-list",
  "action-button-group",
  "macro-button",
  "timer-display",
  "timeseries-chart",
  "stat-grid",
] as const;

export const UiComponentKindSchema = z.enum([
  ...PIUI_ATOM_KINDS,
  ...PIUI_MOLECULE_KINDS,
  ...COMPOSER_COMPONENT_KINDS,
]);
export type UiComponentKind = z.infer<typeof UiComponentKindSchema>;

export const UiComponentNodeSchema = z.object({
  type: z.literal("component").default("component"),
  id: z.string(),
  component: UiComponentKindSchema,
  props: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(UiActionBindingSchema).default([]),
  condition: UiVisibilityConditionSchema.optional(),
  showForSec: z.number().positive().optional(),
  expiresAt: z.string().optional(),
});
export type UiComponentNode = z.infer<typeof UiComponentNodeSchema>;

export const PanelToneSchema = z.enum([
  "default",
  "advisory",
  "directing",
  "manual",
  "preflight",
  "standing-rule",
]);
export type PanelTone = z.infer<typeof PanelToneSchema>;

export const PanelZoneSchema = z.enum(["top", "main", "sidebar", "bottom", "overlay"]);
export type PanelZone = z.infer<typeof PanelZoneSchema>;

/**
 * Layout Node: Panel
 */
export const UiPanelNodeSchema = z.object({
  type: z.literal("panel").default("panel"),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  tone: PanelToneSchema.default("default"),
  zone: PanelZoneSchema.default("main"),
  sourceLabel: z.string().optional(),
  ruleId: z.string().optional(),
  savedComponentSlug: z.string().optional(),
  savedComponentName: z.string().optional(),
  collapsible: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  pinned: z.boolean().default(false),
  condition: UiVisibilityConditionSchema.optional(),
  showForSec: z.number().positive().optional(),
  expiresAt: z.string().optional(),
  rectHint: UiScreenRectSchema.optional(),
  actions: z.array(UiActionBindingSchema).default([]),
  children: z.array(UiComponentNodeSchema).default([]),
});
export type UiPanelNode = z.infer<typeof UiPanelNodeSchema>;

/**
 * Layout Node: Division (grid / horizontal / vertical split container holding Panels)
 */
export const UiDivisionSlotSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  colSpan: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  panels: z.array(UiPanelNodeSchema).default([]),
});
export type UiDivisionSlot = z.infer<typeof UiDivisionSlotSchema>;

export const UiDivisionNodeSchema = z.object({
  type: z.literal("division").default("division"),
  id: z.string(),
  direction: z.enum(["horizontal", "vertical", "grid"]).default("grid"),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
  gap: z.enum(["xs", "sm", "md", "lg"]).default("md"),
  divided: z.boolean().default(false),
  slots: z.array(UiDivisionSlotSchema).default([]),
});
export type UiDivisionNode = z.infer<typeof UiDivisionNodeSchema>;

/**
 * Layout Node: Hover (floating overlay / popover / advisory banner)
 */
export const UiHoverNodeSchema = z.object({
  type: z.literal("hover").default("hover"),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  placement: z
    .enum(["top-right", "bottom-right", "bottom-bar", "top-bar", "center-modal", "inline-popover"])
    .default("top-right"),
  tone: z.enum(["neutral", "advisory", "directing", "warning", "urgent"]).default("advisory"),
  badgeLabel: z.string().optional(),
  ruleId: z.string().optional(),
  dismissible: z.boolean().default(true),
  pinned: z.boolean().default(false),
  autoHideSec: z.number().positive().optional(),
  condition: UiVisibilityConditionSchema.optional(),
  showForSec: z.number().positive().optional(),
  expiresAt: z.string().optional(),
  actions: z.array(UiActionBindingSchema).default([]),
  children: z.array(UiComponentNodeSchema).default([]),
});
export type UiHoverNode = z.infer<typeof UiHoverNodeSchema>;

/**
 * Top-Level Multi-Screen View Specification (Named Page + Numbered View, e.g. /gui/john/1)
 */
export const UiScreenSpecSchema = z.object({
  screenId: z.string(),
  pageName: z.string().default("1"),
  viewNumber: z.number().int().positive().default(1),
  screenName: z.string(),
  role: ScreenRoleSchema,
  layoutMode: LayoutModeSchema.default("grid"),
  generatedBy: z.enum(["context-reactive-agent", "prompted-creator-agent", "hybrid"]),
  updatedAt: z.string(),
  reason: z.string(),
  broadcastPhase: BroadcastPhaseSchema,
  directorMode: DirectorModeSchema,
  contextSummary: z.object({
    broadcastId: z.string().nullable(),
    broadcastTitle: z.string().nullable(),
    placeInEvent: z.string().nullable(),
    activeSection: z.string().nullable(),
    activeSubsection: z.string().nullable(),
    completedSections: z.array(z.string()).default([]),
    timingSummary: z.string().nullable(),
    nextItemTitle: z.string().nullable(),
    programInput: z.number(),
    previewInput: z.number(),
  }),
  activeStandingRuleIds: z.array(z.string()).default([]),
  divisions: z.array(UiDivisionNodeSchema).default([]),
  hovers: z.array(UiHoverNodeSchema).default([]),
});
export type UiScreenSpec = z.infer<typeof UiScreenSpecSchema>;

/**
 * Mouse Context (bound when user activates UI editing and either clicks a component
 * or draws a rectangle area on /gui/:name/:number).
 */
export const MouseSelectionContextSchema = z.object({
  mode: z.enum(["none", "component", "rectangle", "area"]).default("none"),
  pageName: z.string().default("1"),
  viewNumber: z.number().int().positive().default(1),
  componentId: z.string().optional(),
  componentType: z.string().optional(),
  panelId: z.string().optional(),
  label: z.string().optional(),
  rect: UiScreenRectSchema.optional(),
  overlappingPanelIds: z.array(z.string()).optional(),
  overlappingComponentIds: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});
export type MouseSelectionContext = z.infer<typeof MouseSelectionContextSchema>;

export interface LastMessageContext {
  prompt: string;
  responseSummary: string;
  targetPage: string;
  targetView: number;
  targetScreenId: string;
  intent: string;
  timestamp: string;
}

/**
 * Saved Named UI Component (e.g. user draws a rectangle and prompts "save these as sermon controls")
 */
export const SavedUiComponentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  panels: z.array(UiPanelNodeSchema).default([]),
  components: z.array(UiComponentNodeSchema).default([]),
  createdAt: z.string(),
  sourcePage: z.string().optional(),
  sourceView: z.number().optional(),
});
export type SavedUiComponent = z.infer<typeof SavedUiComponentSchema>;

/**
 * UI Cue (a.k.a. standing UI rule) trigger. A UI cue mounts a panel/hover on a view while its
 * trigger holds: a rundown section/cue condition, director state, audio class, and/or a spoken
 * phrase/topic heard in captions (e.g. "if speaker speaks about resurrection").
 */
export const StandingRuleTriggerSchema = z.object({
  phase: z.enum(["preflight", "live", "post", "always"]).default("live"),
  section: z.string().nullable().optional(),
  subsection: z.string().nullable().optional(),
  cueId: z.string().nullable().optional(),
  conditionOperator: z.enum(["during", "after", "before", "not_during", "always"]).default("during"),
  directorState: z.enum(["advising", "directing", "manual", "any"]).default("any"),
  audioClassification: z.enum(["speech", "music", "silence", "any"]).default("any"),
  phrase: z.string().nullable().optional(),
  phraseHoldSec: z.number().positive().default(120).optional(),
});
export type StandingRuleTrigger = z.infer<typeof StandingRuleTriggerSchema>;

export const StandingUiRuleCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  promptText: z.string().optional(),
  targetScreenId: z.string().default("1/1"),
  targetZone: PanelZoneSchema.default("main"),
  container: z.enum(["panel", "hover"]).default("panel"),
  durability: z.enum(["persistent", "broadcast"]).default("persistent"),
  enabled: z.boolean().default(true),
  trigger: StandingRuleTriggerSchema.default({}),
  panel: UiPanelNodeSchema.optional(),
  hover: UiHoverNodeSchema.optional(),
});
export type StandingUiRuleCreate = z.infer<typeof StandingUiRuleCreateSchema>;

export interface StandingUiRule {
  id: string;
  name: string;
  description: string;
  promptText: string | null;
  targetScreenId: string;
  targetZone: PanelZone;
  container: "panel" | "hover";
  durability: "persistent" | "broadcast";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  trigger: StandingRuleTrigger;
  panel?: UiPanelNode | undefined;
  hover?: UiHoverNode | undefined;
}
