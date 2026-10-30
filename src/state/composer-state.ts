import path from "node:path";
import type { ComposerEventBroker } from "../events.js";
import type {
  BroadcastPhase,
  DirectorMode,
  LastMessageContext,
  MouseSelectionContext,
  ScreenRole,
  UiScreenSpec,
  UiVisibilityCondition,
} from "../schema/ui-schema.js";
import { SavedComponentsStore } from "./saved-components-store.js";
import { TimeSeriesStore } from "./timeseries-store.js";

export interface DirectorAdvisorySnapshot {
  id: string;
  trigger: string;
  recommendedAction: "cut" | "hold" | "prepare_only";
  cutToInput?: number | undefined;
  prepareCamera?: {
    camera: number | string;
    preset: number | string;
  } | undefined;
  graphics?: {
    showLowerThird: boolean;
    title?: string | undefined;
    subtitle?: string | undefined;
  } | undefined;
  rationale: string;
  createdAt: string;
}

export interface DirectorActiveShotSnapshot {
  trigger: string;
  recommendedAction: "cut" | "hold" | "prepare_only";
  cutToInput?: number | undefined;
  prepareCamera?: {
    camera: number | string;
    preset: number | string;
  } | undefined;
  rationale: string;
  timestamp: string;
}

export interface OperatorManualActionSnapshot {
  actor: string;
  action: string;
  targetCamera?: number | string | undefined;
  targetInput?: number | undefined;
  reason?: string | undefined;
  timestamp: string;
}

export interface SpokenPhraseSnapshot {
  phrase: string;
  timestamp: string;
}

export interface BroadcastContextState {
  phase: BroadcastPhase;
  broadcastStartedAt: string;
  sectionStartedAt: string;
  itemStartedAt: string;
  pitube: {
    connected: boolean;
    state: "idle" | "ready" | "testing" | "live" | "complete" | "offline" | "unknown";
    broadcastId: string | null;
    title: string | null;
    streamHealth: string | null;
  };
  director: {
    connected: boolean;
    broadcastId: string | null;
    mode: DirectorMode;
    lastActiveMode: DirectorMode;
    pendingAdvisory: DirectorAdvisorySnapshot | null;
    lastDecision: DirectorActiveShotSnapshot | null;
    lastOperatorAction: OperatorManualActionSnapshot | null;
    steeringNotes: Array<{
      id: string;
      text: string;
      scope: string;
      enabled: boolean;
      expired: boolean;
    }>;
    recentLogs: Array<{
      id: string;
      timestamp: string;
      category: string;
      headline: string;
      detail: string;
    }>;
  };
  rundown: {
    loaded: boolean;
    title: string | null;
    service: string | null;
    church: string | null;
    date: string | null;
    placeInEvent: string | null;
    currentCueId: string | null;
    currentCueTitle: string | null;
    currentSection: string | null;
    currentSubsection: string | null;
    assignedSpeaker: string | null;
    expectedDurationSec: number | null;
    timerSec: number | null;
    overtime: boolean;
    timingSummary: string | null;
    completedSections: string[];
    completedCues: string[];
    nextItem: {
      id: string;
      title: string;
      section?: string | null | undefined;
      cueSummary?: string | null | undefined;
    } | null;
  };
  hardware: {
    atemConnected: boolean;
    programInput: number;
    previewInput: number;
    dwellSec: number;
    camerasConnected: boolean;
    voiceActive: boolean;
    audioClassification: "speech" | "music" | "silence";
    tallyConnected: boolean;
  };
  captions: {
    voiceActive: boolean;
    lastTranscript: string | null;
    recentPhrases: SpokenPhraseSnapshot[];
  };
}

export interface ScreenSlotMetadata {
  screenId: string;
  pageName: string;
  viewNumber: number;
  aliases: string[];
  screenName: string;
  role: ScreenRole;
  managedBy: "context-reactive-agent" | "prompted-creator-agent";
  spec: UiScreenSpec | null;
}

export interface PageRegistrySummary {
  pageName: string;
  views: Array<{
    viewNumber: number;
    screenId: string;
    screenName: string;
    role: ScreenRole;
    route: string;
  }>;
}

const SCREEN_ALIASES: Record<string, string> = {
  copilot: "screen-1",
  advisory: "screen-1",
  director: "screen-1",
  "1/1": "screen-1",
  operator: "screen-2",
  workspace: "screen-2",
  custom: "screen-2",
  "1/2": "screen-2",
  preflight: "screen-3",
  setup: "screen-3",
  "1/3": "screen-3",
};

export function matchesSectionOrTopic(actual: string | null | undefined, target: string): boolean {
  if (!actual) return false;
  const a = actual.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (!a || !t) return false;
  if (a.includes(t) || t.includes(a)) return true;
  if (t === "sermon" && a.includes("saarna")) return true;
  if (t === "saarna" && a.includes("sermon")) return true;
  if (t === "communion" && a.includes("ehtoollinen")) return true;
  if (t === "ehtoollinen" && a.includes("communion")) return true;
  if (t === "praise" && a.includes("ylistys")) return true;
  if (t === "ylistys" && a.includes("praise")) return true;
  return false;
}

export function evaluateVisibilityCondition(
  condition: UiVisibilityCondition | undefined,
  context: BroadcastContextState
): boolean {
  if (!condition) return true;
  if (condition.phase && condition.phase !== "always" && condition.phase !== context.phase) {
    return false;
  }
  const op = condition.operator ?? "always";
  if (op === "always") return true;

  const target = condition.section ?? condition.subsection ?? condition.cueId;
  if (!target) return true;

  const isCurrent =
    matchesSectionOrTopic(context.rundown.currentSection, target) ||
    matchesSectionOrTopic(context.rundown.currentSubsection, target) ||
    matchesSectionOrTopic(context.rundown.currentCueTitle, target) ||
    matchesSectionOrTopic(context.rundown.currentCueId, target);

  const isCompleted =
    context.rundown.completedSections.some((s) => matchesSectionOrTopic(s, target)) ||
    context.rundown.completedCues.some((c) => matchesSectionOrTopic(c, target));

  switch (op) {
    case "during":
      return isCurrent;
    case "after":
      return isCompleted && !isCurrent;
    case "before":
      return !isCurrent && !isCompleted;
    case "not_during":
      return !isCurrent;
    default:
      return true;
  }
}

export function isNotExpired(expiresAt: string | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return true;
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) return true;
  return nowMs < exp;
}

export class ComposerState {
  private readonly eventBroker?: ComposerEventBroker | undefined;
  readonly timeSeriesStore: TimeSeriesStore;
  readonly savedComponentsStore: SavedComponentsStore;

  private mouseContext: MouseSelectionContext = {
    mode: "none",
    pageName: "1",
    viewNumber: 1,
    updatedAt: new Date().toISOString(),
  };

  private lastMessageContext: LastMessageContext | null = null;

  private context: BroadcastContextState = {
    phase: "preflight",
    broadcastStartedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    sectionStartedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    itemStartedAt: new Date(Date.now() - 95 * 1000).toISOString(),
    pitube: {
      connected: true,
      state: "idle",
      broadcastId: null,
      title: null,
      streamHealth: "unknown",
    },
    director: {
      connected: true,
      broadcastId: null,
      mode: "advisory",
      lastActiveMode: "advisory",
      pendingAdvisory: null,
      lastDecision: null,
      lastOperatorAction: null,
      steeringNotes: [],
      recentLogs: [],
    },
    rundown: {
      loaded: false,
      title: null,
      service: null,
      church: null,
      date: null,
      placeInEvent: null,
      currentCueId: null,
      currentCueTitle: null,
      currentSection: null,
      currentSubsection: null,
      assignedSpeaker: null,
      expectedDurationSec: null,
      timerSec: null,
      overtime: false,
      timingSummary: null,
      completedSections: [],
      completedCues: [],
      nextItem: null,
    },
    hardware: {
      atemConnected: true,
      programInput: 1,
      previewInput: 2,
      dwellSec: 0,
      camerasConnected: true,
      voiceActive: true,
      audioClassification: "silence",
      tallyConnected: true,
    },
    captions: {
      voiceActive: true,
      lastTranscript: null,
      recentPhrases: [],
    },
  };

  private readonly screens = new Map<string, ScreenSlotMetadata>();

  constructor(eventBroker?: ComposerEventBroker, dataDir = path.resolve("data")) {
    this.eventBroker = eventBroker;
    this.timeSeriesStore = new TimeSeriesStore();
    this.savedComponentsStore = new SavedComponentsStore(dataDir);
    this.registerDefaultScreens();
  }

  private registerDefaultScreens(): void {
    this.screens.set("screen-1", {
      screenId: "screen-1",
      pageName: "1",
      viewNumber: 1,
      aliases: ["copilot", "advisory", "director", "1/1"],
      screenName: "Screen 1 — Director Co-Pilot & Broadcast Context",
      role: "copilot",
      managedBy: "context-reactive-agent",
      spec: null,
    });
    this.screens.set("screen-2", {
      screenId: "screen-2",
      pageName: "1",
      viewNumber: 2,
      aliases: ["operator", "workspace", "custom", "1/2"],
      screenName: "Screen 2 — Prompted Operator Workspace",
      role: "operator",
      managedBy: "prompted-creator-agent",
      spec: null,
    });
    this.screens.set("screen-3", {
      screenId: "screen-3",
      pageName: "1",
      viewNumber: 3,
      aliases: ["preflight", "setup", "1/3"],
      screenName: "Screen 3 — Setup, Preflight & Rundown",
      role: "preflight",
      managedBy: "context-reactive-agent",
      spec: null,
    });
  }

  resolvePageView(
    name?: string | null,
    number?: string | number | null
  ): { pageName: string; viewNumber: number; screenId: string } {
    const rawName = (name ?? "1").trim() || "1";
    const parsedNum =
      typeof number === "number"
        ? number
        : number !== undefined && number !== null && String(number).trim() !== ""
          ? Number.parseInt(String(number).trim(), 10)
          : 1;
    const viewNumber = Number.isFinite(parsedNum) && parsedNum >= 1 ? parsedNum : 1;

    // Check if rawName already encodes "screen-1" etc.
    const lower = rawName.toLowerCase();
    if (lower === "screen-1" || lower === "copilot" || lower === "advisory" || lower === "director") {
      return { pageName: "1", viewNumber: 1, screenId: "screen-1" };
    }
    if (lower === "screen-2" || lower === "operator" || lower === "workspace") {
      return { pageName: "1", viewNumber: 2, screenId: "screen-2" };
    }
    if (lower === "screen-3" || lower === "preflight" || lower === "setup") {
      return { pageName: "1", viewNumber: 3, screenId: "screen-3" };
    }

    const pageName = lower;
    const candidateAlias = `${pageName}/${viewNumber}`;
    const screenId = SCREEN_ALIASES[candidateAlias] ?? candidateAlias;
    return { pageName, viewNumber, screenId };
  }

  resolveScreenId(idOrAlias: string): string {
    const normalized = idOrAlias.trim().toLowerCase();
    if (SCREEN_ALIASES[normalized]) {
      return SCREEN_ALIASES[normalized]!;
    }
    if (normalized.includes("/")) {
      const [p, v] = normalized.split("/");
      return this.resolvePageView(p, v).screenId;
    }
    return normalized;
  }

  ensureScreen(
    idOrAlias: string,
    options?: {
      screenName?: string | undefined;
      pageName?: string | undefined;
      viewNumber?: number | undefined;
      role?: ScreenRole | undefined;
      managedBy?: "context-reactive-agent" | "prompted-creator-agent" | undefined;
    }
  ): ScreenSlotMetadata {
    const screenId = this.resolveScreenId(idOrAlias);
    let slot = this.screens.get(screenId);
    if (!slot) {
      let pageName = options?.pageName ?? "1";
      let viewNumber = options?.viewNumber ?? 1;
      if (screenId.includes("/")) {
        const [p, v] = screenId.split("/");
        pageName = p || "1";
        viewNumber = Number.parseInt(v || "1", 10) || 1;
      } else if (screenId.startsWith("screen-")) {
        pageName = "1";
        viewNumber = Number.parseInt(screenId.replace("screen-", ""), 10) || 1;
      }
      slot = {
        screenId,
        pageName,
        viewNumber,
        aliases: [`${pageName}/${viewNumber}`],
        screenName:
          options?.screenName ??
          (pageName === "1"
            ? `Screen ${viewNumber}`
            : `${pageName.toUpperCase()} — View ${viewNumber}`),
        role: options?.role ?? "custom",
        managedBy: options?.managedBy ?? "prompted-creator-agent",
        spec: null,
      };
      this.screens.set(screenId, slot);
    } else {
      if (options?.screenName) slot.screenName = options.screenName;
      if (options?.pageName) slot.pageName = options.pageName;
      if (options?.viewNumber) slot.viewNumber = options.viewNumber;
      if (options?.role) slot.role = options.role;
      if (options?.managedBy) slot.managedBy = options.managedBy;
    }
    return slot;
  }

  ensurePageView(name?: string | null, number?: string | number | null): ScreenSlotMetadata {
    const { pageName, viewNumber, screenId } = this.resolvePageView(name, number);
    return this.ensureScreen(screenId, { pageName, viewNumber });
  }

  getScreen(idOrAlias: string): ScreenSlotMetadata | null {
    const screenId = this.resolveScreenId(idOrAlias);
    return this.screens.get(screenId) ?? null;
  }

  listScreens(): ScreenSlotMetadata[] {
    return Array.from(this.screens.values()).map((s) => ({
      ...s,
      aliases: [...s.aliases],
      spec: s.spec ? structuredClone(s.spec) : null,
    }));
  }

  listPages(): PageRegistrySummary[] {
    const byPage = new Map<string, PageRegistrySummary>();
    for (const s of this.screens.values()) {
      let page = byPage.get(s.pageName);
      if (!page) {
        page = { pageName: s.pageName, views: [] };
        byPage.set(s.pageName, page);
      }
      page.views.push({
        viewNumber: s.viewNumber,
        screenId: s.screenId,
        screenName: s.screenName,
        role: s.role,
        route: `/gui/${encodeURIComponent(s.pageName)}/${s.viewNumber}`,
      });
    }
    for (const page of byPage.values()) {
      page.views.sort((a, b) => a.viewNumber - b.viewNumber);
    }
    return Array.from(byPage.values());
  }

  setScreenSpec(idOrAlias: string, spec: UiScreenSpec): UiScreenSpec {
    const slot = this.ensureScreen(idOrAlias, {
      screenName: spec.screenName,
      pageName: spec.pageName,
      viewNumber: spec.viewNumber,
      role: spec.role,
    });
    spec.pageName = slot.pageName;
    spec.viewNumber = slot.viewNumber;
    slot.spec = structuredClone(spec);
    this.eventBroker?.emit({
      type: "screen-updated",
      data: slot.spec,
    });
    return slot.spec;
  }

  getMouseContext(): MouseSelectionContext {
    return structuredClone(this.mouseContext);
  }

  setMouseContext(next: Partial<MouseSelectionContext> & { mode: MouseSelectionContext["mode"] }): MouseSelectionContext {
    this.mouseContext = {
      mode: next.mode,
      pageName: next.pageName ?? this.mouseContext.pageName ?? "1",
      viewNumber: next.viewNumber ?? this.mouseContext.viewNumber ?? 1,
      componentId: next.componentId,
      componentType: next.componentType,
      panelId: next.panelId,
      label: next.label,
      rect: next.rect,
      overlappingComponentIds: next.overlappingComponentIds,
      overlappingPanelIds: next.overlappingPanelIds,
      updatedAt: new Date().toISOString(),
    };
    this.eventBroker?.emit({
      type: "context-updated",
      data: { mouseContext: this.mouseContext },
    });
    return this.getMouseContext();
  }

  clearMouseContext(pageName?: string, viewNumber?: number): MouseSelectionContext {
    this.mouseContext = {
      mode: "none",
      pageName: pageName ?? this.mouseContext.pageName ?? "1",
      viewNumber: viewNumber ?? this.mouseContext.viewNumber ?? 1,
      updatedAt: new Date().toISOString(),
    };
    return this.getMouseContext();
  }

  getLastMessageContext(): LastMessageContext | null {
    return this.lastMessageContext ? structuredClone(this.lastMessageContext) : null;
  }

  setLastMessageContext(msg: LastMessageContext): LastMessageContext {
    this.lastMessageContext = structuredClone(msg);
    return this.getLastMessageContext()!;
  }

  getContext(): BroadcastContextState {
    return structuredClone(this.context);
  }

  private syncPhase(): void {
    const ptState = this.context.pitube.state;
    if (ptState === "live" || ptState === "testing") {
      this.context.phase = "live";
    } else if (ptState === "complete") {
      this.context.phase = "post";
    } else if (this.context.rundown.currentCueId && ptState !== "idle" && ptState !== "ready") {
      this.context.phase = "live";
    } else {
      this.context.phase = "preflight";
    }
  }

  updatePitube(data: Record<string, any>): void {
    const selected = data["selectedBroadcast"] ?? data["broadcast"];
    if (data["state"] !== undefined || data["lifecycleState"] !== undefined) {
      this.context.pitube.state = data["lifecycleState"] ?? data["state"];
    }
    if (selected?.["id"] !== undefined || data["broadcastId"] !== undefined) {
      this.context.pitube.broadcastId = selected?.["id"] ?? data["broadcastId"] ?? null;
    }
    if (selected?.["title"] !== undefined || data["title"] !== undefined) {
      this.context.pitube.title = selected?.["title"] ?? data["title"] ?? null;
    }
    if (typeof data["detail"] === "string") {
      const m = /^Broadcast:\s+(.+?)\s+\((ready|testing|live|complete|idle)/i.exec(
        data["detail"].trim()
      );
      if (m) {
        this.context.pitube.title = m[1]!.trim();
        this.context.pitube.state = m[2]!.toLowerCase() as any;
      }
    }
    if (data["streamHealth"] !== undefined) {
      this.context.pitube.streamHealth = data["streamHealth"];
    }
    if (data["connected"] !== undefined) {
      this.context.pitube.connected = Boolean(data["connected"]);
    }
    if (typeof data["bitrateKbps"] === "number") {
      this.timeSeriesStore.record("stream_bitrate_kbps", data["bitrateKbps"]);
    }
    this.syncPhase();
  }

  updateDirector(data: Record<string, any>): void {
    if (data["mode"] !== undefined) {
      this.context.director.mode = data["mode"];
    }
    if (data["lastActiveMode"] !== undefined) {
      this.context.director.lastActiveMode = data["lastActiveMode"];
    }
    if (data["broadcastId"] !== undefined) {
      this.context.director.broadcastId = data["broadcastId"];
    }
    if ("pendingAdvisory" in data) {
      const adv = data["pendingAdvisory"];
      this.context.director.pendingAdvisory = adv
        ? {
            id: adv.id,
            trigger: adv.trigger ?? "cue",
            recommendedAction: adv.decision?.recommendedAction ?? adv.recommendedAction ?? "cut",
            cutToInput: adv.decision?.cutToInput ?? adv.cutToInput,
            prepareCamera: adv.decision?.prepareCamera ?? adv.prepareCamera,
            graphics: adv.decision?.graphics ?? adv.graphics,
            rationale: adv.decision?.rationale ?? adv.rationale ?? "AI Co-Pilot suggestion",
            createdAt: adv.createdAt ?? new Date().toISOString(),
          }
        : null;
    }
    if (data["lastDecision"] !== undefined) {
      const dec = data["lastDecision"];
      this.context.director.lastDecision = dec
        ? {
            trigger: dec.trigger ?? "auto",
            recommendedAction: dec.decision?.recommendedAction ?? dec.recommendedAction ?? "cut",
            cutToInput: dec.decision?.cutToInput ?? dec.cutToInput,
            prepareCamera: dec.decision?.prepareCamera ?? dec.prepareCamera,
            rationale: dec.decision?.rationale ?? dec.rationale ?? "Autonomous director cut",
            timestamp: dec.timestamp ?? dec.time ?? new Date().toISOString(),
          }
        : null;
    }
    if (data["lastOperatorAction"] !== undefined) {
      this.context.director.lastOperatorAction = data["lastOperatorAction"];
    }
    if (Array.isArray(data["steering"]?.["notes"]) || Array.isArray(data["steeringNotes"])) {
      this.context.director.steeringNotes = (
        data["steering"]?.["notes"] ?? data["steeringNotes"]
      ).map((n: any) => ({
        id: String(n.id),
        text: String(n.text),
        scope: String(n.scope ?? "broadcast"),
        enabled: Boolean(n.enabled ?? true),
        expired: Boolean(n.expired ?? false),
      }));
    }
    if (Array.isArray(data["recentLogs"])) {
      this.context.director.recentLogs = data["recentLogs"].slice(-10).map((l: any) => ({
        id: String(l.id),
        timestamp: String(l.timestamp),
        category: String(l.category),
        headline: String(l.headline),
        detail: String(l.detail),
      }));
    }
  }

  updateRundown(data: Record<string, any>): void {
    const currentItem = data["currentItem"] as Record<string, any> | undefined;
    const progress = data["progress"] as Record<string, any> | undefined;

    if (data["title"] !== undefined) {
      this.context.rundown.title = data["title"];
      this.context.rundown.loaded = Boolean(data["title"]);
    }
    if (data["service"] !== undefined) this.context.rundown.service = data["service"];
    if (data["church"] !== undefined) this.context.rundown.church = data["church"];
    if (data["date"] !== undefined) this.context.rundown.date = data["date"];

    const prevSection = this.context.rundown.currentSection;
    const prevCueTitle = this.context.rundown.currentCueTitle;
    const prevCueId = this.context.rundown.currentCueId;

    const cueId = data["currentCueId"] ?? data["cueId"] ?? currentItem?.["id"];
    if (cueId !== undefined) {
      if (prevCueId && prevCueId !== cueId && !this.context.rundown.completedCues.includes(prevCueId)) {
        this.context.rundown.completedCues.push(prevCueId);
      }
      if (prevCueTitle && !this.context.rundown.completedCues.includes(prevCueTitle)) {
        this.context.rundown.completedCues.push(prevCueTitle);
      }
      this.context.rundown.currentCueId = cueId;
      this.context.rundown.loaded = true;
      this.context.itemStartedAt = new Date().toISOString();
    }
    const cueTitle = data["currentCueTitle"] ?? data["cueTitle"] ?? currentItem?.["title"];
    if (cueTitle !== undefined) {
      if (
        prevCueTitle &&
        prevCueTitle !== cueTitle &&
        !this.context.rundown.completedCues.includes(prevCueTitle)
      ) {
        this.context.rundown.completedCues.push(prevCueTitle);
      }
      this.context.rundown.currentCueTitle = cueTitle;
    }
    const section =
      data["currentSection"] ??
      currentItem?.["section"] ??
      progress?.["section"]?.["title"] ??
      data["section"];
    if (section !== undefined) {
      if (
        prevSection &&
        prevSection !== section &&
        !this.context.rundown.completedSections.includes(prevSection)
      ) {
        this.context.rundown.completedSections.push(prevSection);
      }
      this.context.rundown.currentSection = section;
      if (prevSection !== section) {
        this.context.sectionStartedAt = new Date().toISOString();
      }
    }
    if (Array.isArray(data["completedSections"])) {
      for (const s of data["completedSections"]) {
        if (typeof s === "string" && !this.context.rundown.completedSections.includes(s)) {
          this.context.rundown.completedSections.push(s);
        }
      }
    }
    const subsection =
      progress?.["subsection"]?.["title"] ??
      progress?.["subsection"]?.["id"] ??
      data["currentSubsection"];
    if (subsection !== undefined) {
      this.context.rundown.currentSubsection = subsection;
    }

    if (data["placeInEvent"] !== undefined || progress?.["placeInEvent"] !== undefined) {
      this.context.rundown.placeInEvent = data["placeInEvent"] ?? progress?.["placeInEvent"];
    }
    if (data["assignedSpeaker"] !== undefined || data["speaker"] !== undefined) {
      this.context.rundown.assignedSpeaker = data["assignedSpeaker"] ?? data["speaker"];
    }
    if (data["expectedDurationSec"] !== undefined || currentItem?.["expectedDurationSec"] !== undefined) {
      this.context.rundown.expectedDurationSec =
        data["expectedDurationSec"] ?? currentItem?.["expectedDurationSec"];
    }
    if (data["timerSec"] !== undefined || currentItem?.["timerSec"] !== undefined) {
      this.context.rundown.timerSec = data["timerSec"] ?? currentItem?.["timerSec"];
    }
    if (progress?.["subsection"]?.["overtime"] !== undefined || progress?.["section"]?.["overtime"] !== undefined) {
      this.context.rundown.overtime = Boolean(
        progress?.["subsection"]?.["overtime"] || progress?.["section"]?.["overtime"]
      );
    }
    if (progress?.["summary"] !== undefined || data["timingSummary"] !== undefined) {
      this.context.rundown.timingSummary = progress?.["summary"] ?? data["timingSummary"];
    }
    if (data["nextItem"] !== undefined) {
      this.context.rundown.nextItem = data["nextItem"]
        ? {
            id: String(data["nextItem"].id),
            title: String(data["nextItem"].title),
            section: data["nextItem"].section ?? null,
            cueSummary: data["nextItem"].cueSummary ?? null,
          }
        : null;
    }
    if (data["phase"] === "live" || data["live"] === true) {
      this.context.pitube.state = "live";
    }
    this.syncPhase();
  }

  updateHardware(data: {
    atemConnected?: boolean | undefined;
    programInput?: number | undefined;
    previewInput?: number | undefined;
    dwellSec?: number | undefined;
    camerasConnected?: boolean | undefined;
    voiceActive?: boolean | undefined;
    audioClassification?: "speech" | "music" | "silence" | undefined;
    tallyConnected?: boolean | undefined;
    audioRmsDbfs?: number | undefined;
    captionLagMs?: number | undefined;
    cameraMotionSpeed?: number | undefined;
  }): void {
    if (data.atemConnected !== undefined) this.context.hardware.atemConnected = data.atemConnected;
    if (data.programInput !== undefined) this.context.hardware.programInput = data.programInput;
    if (data.previewInput !== undefined) this.context.hardware.previewInput = data.previewInput;
    if (data.dwellSec !== undefined) {
      this.context.hardware.dwellSec = data.dwellSec;
      this.timeSeriesStore.record("shot_dwell_sec", data.dwellSec);
    }
    if (data.camerasConnected !== undefined) {
      this.context.hardware.camerasConnected = data.camerasConnected;
    }
    if (data.voiceActive !== undefined) {
      this.context.hardware.voiceActive = data.voiceActive;
      this.context.captions.voiceActive = data.voiceActive;
    }
    if (data.audioClassification !== undefined) {
      this.context.hardware.audioClassification = data.audioClassification;
    }
    if (data.tallyConnected !== undefined) {
      this.context.hardware.tallyConnected = data.tallyConnected;
    }
    if (data.audioRmsDbfs !== undefined) {
      this.timeSeriesStore.record("audio_rms_dbfs", data.audioRmsDbfs);
    }
    if (data.captionLagMs !== undefined) {
      this.timeSeriesStore.record("caption_lag_ms", data.captionLagMs);
    }
    if (data.cameraMotionSpeed !== undefined) {
      this.timeSeriesStore.record("camera_motion_speed", data.cameraMotionSpeed);
    }
  }

  ingestTranscript(text: string, timestamp?: string): void {
    const ts = timestamp ?? new Date().toISOString();
    this.context.captions.lastTranscript = text;
    this.context.captions.voiceActive = true;
    this.context.hardware.voiceActive = true;

    const normalized = text.toLowerCase().trim();
    if (normalized) {
      this.context.captions.recentPhrases.push({
        phrase: normalized,
        timestamp: ts,
      });
      if (this.context.captions.recentPhrases.length > 50) {
        this.context.captions.recentPhrases.shift();
      }
    }

    this.eventBroker?.emit({
      type: "transcript-received",
      data: { text, timestamp: ts },
    });
  }
}
