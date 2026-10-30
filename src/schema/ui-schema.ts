import { z } from "zod";

export const BroadcastPhaseSchema = z.enum(["preflight", "live", "post"]);
export type BroadcastPhase = z.infer<typeof BroadcastPhaseSchema>;

export const DirectorModeSchema = z.enum(["autonomous", "advisory", "manual"]);
export type DirectorMode = z.infer<typeof DirectorModeSchema>;

export const ScreenRoleSchema = z.enum(["copilot", "operator", "preflight", "custom"]);
export type ScreenRole = z.infer<typeof ScreenRoleSchema>;

/**
 * Typed Action Bindings for UI components.
 * Maps button presses and controls to ecosystem APIs / MCP tools.
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
  "atem.preview",
  "atem.auto",
  "camera.preset",
  "camera.move",
  "graphics.lowerThird",
  "pitube.select",
  "pitube.create",
  "pitube.start",
  "pitube.stop",
  "rundown.next",
  "tally.cue",
  "voice.captureStart",
]);
export type UiActionType = z.infer<typeof UiActionTypeSchema>;

export const UiActionBindingSchema = z.object({
  id: z.string(),
  label: z.string(),
  action: UiActionTypeSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  variant: z
    .enum(["primary", "secondary", "danger", "ghost", "surface-high", "atem-pgm", "atem-pvw"])
    .default("primary"),
  icon: z.string().optional(),
});
export type UiActionBinding = z.infer<typeof UiActionBindingSchema>;

/**
 * Typed PiUI Component Nodes (Atoms & Molecules inside Panels / Divisions / Hovers)
 */
export const UiComponentKindSchema = z.enum([
  "director-advisory-card",
  "director-active-shot-card",
  "manual-override-card",
  "graphics-lower-third-panel",
  "preflight-checklist-card",
  "atem-bus-selector",
  "ptz-pad",
  "ptz-preset-card",
  "tally-facet-widget",
  "cue-button-group",
  "audio-fader",
  "rundown-item-card",
  "stream-status-card",
  "live-captions-feed",
  "steering-notes-list",
  "decision-log-list",
  "action-button-group",
  "stat-grid",
]);
export type UiComponentKind = z.infer<typeof UiComponentKindSchema>;

export const UiComponentNodeSchema = z.object({
  type: z.literal("component").default("component"),
  id: z.string(),
  component: UiComponentKindSchema,
  props: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(UiActionBindingSchema).default([]),
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
 * Layout Node: Panel (container card with header, tone, source badge, and child components)
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
  collapsible: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  pinned: z.boolean().default(false),
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
  actions: z.array(UiActionBindingSchema).default([]),
  children: z.array(UiComponentNodeSchema).default([]),
});
export type UiHoverNode = z.infer<typeof UiHoverNodeSchema>;

/**
 * Top-Level Multi-Screen Specification (Typed JSON output of picomposer)
 */
export const UiScreenSpecSchema = z.object({
  screenId: z.string(),
  screenName: z.string(),
  role: ScreenRoleSchema,
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
 * Standing UI Rule Schema (persisted across broadcasts in data/standing-rules.json
 * or scoped to the current broadcast).
 */
export const StandingRuleTriggerSchema = z.object({
  phase: z.enum(["preflight", "live", "post", "always"]).default("live"),
  section: z.string().nullable().optional(),
  subsection: z.string().nullable().optional(),
  cueId: z.string().nullable().optional(),
  directorState: z.enum(["advising", "directing", "manual", "any"]).default("any"),
  audioClassification: z.enum(["speech", "music", "silence", "any"]).default("any"),
});
export type StandingRuleTrigger = z.infer<typeof StandingRuleTriggerSchema>;

export const StandingUiRuleCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  promptText: z.string().optional(),
  targetScreenId: z.string().default("screen-1"),
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
