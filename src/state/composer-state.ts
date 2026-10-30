import type { ComposerEventBroker } from "../events.js";
import type {
  BroadcastPhase,
  DirectorMode,
  ScreenRole,
  UiScreenSpec,
} from "../schema/ui-schema.js";

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

export interface BroadcastContextState {
  phase: BroadcastPhase;
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
}

export interface ScreenSlotMetadata {
  screenId: string;
  aliases: string[];
  screenName: string;
  role: ScreenRole;
  managedBy: "context-reactive-agent" | "prompted-creator-agent";
  spec: UiScreenSpec | null;
}

const SCREEN_ALIASES: Record<string, string> = {
  copilot: "screen-1",
  advisory: "screen-1",
  director: "screen-1",
  operator: "screen-2",
  workspace: "screen-2",
  custom: "screen-2",
  preflight: "screen-3",
  setup: "screen-3",
};

export class ComposerState {
  private readonly eventBroker?: ComposerEventBroker | undefined;

  private context: BroadcastContextState = {
    phase: "preflight",
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
  };

  private readonly screens = new Map<string, ScreenSlotMetadata>();

  constructor(eventBroker?: ComposerEventBroker) {
    this.eventBroker = eventBroker;
    this.registerDefaultScreens();
  }

  private registerDefaultScreens(): void {
    this.screens.set("screen-1", {
      screenId: "screen-1",
      aliases: ["copilot", "advisory", "director"],
      screenName: "Screen 1 — Director Co-Pilot & Broadcast Context",
      role: "copilot",
      managedBy: "context-reactive-agent",
      spec: null,
    });
    this.screens.set("screen-2", {
      screenId: "screen-2",
      aliases: ["operator", "workspace", "custom"],
      screenName: "Screen 2 — Prompted Operator Workspace",
      role: "operator",
      managedBy: "prompted-creator-agent",
      spec: null,
    });
    this.screens.set("screen-3", {
      screenId: "screen-3",
      aliases: ["preflight", "setup"],
      screenName: "Screen 3 — Setup, Preflight & Rundown",
      role: "preflight",
      managedBy: "context-reactive-agent",
      spec: null,
    });
  }

  resolveScreenId(idOrAlias: string): string {
    const normalized = idOrAlias.trim().toLowerCase();
    return SCREEN_ALIASES[normalized] ?? normalized;
  }

  ensureScreen(
    idOrAlias: string,
    options?: {
      screenName?: string | undefined;
      role?: ScreenRole | undefined;
      managedBy?: "context-reactive-agent" | "prompted-creator-agent" | undefined;
    }
  ): ScreenSlotMetadata {
    const screenId = this.resolveScreenId(idOrAlias);
    let slot = this.screens.get(screenId);
    if (!slot) {
      slot = {
        screenId,
        aliases: [],
        screenName: options?.screenName ?? `Screen ${screenId}`,
        role: options?.role ?? "custom",
        managedBy: options?.managedBy ?? "prompted-creator-agent",
        spec: null,
      };
      this.screens.set(screenId, slot);
    } else {
      if (options?.screenName) slot.screenName = options.screenName;
      if (options?.role) slot.role = options.role;
      if (options?.managedBy) slot.managedBy = options.managedBy;
    }
    return slot;
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

  setScreenSpec(idOrAlias: string, spec: UiScreenSpec): UiScreenSpec {
    const slot = this.ensureScreen(idOrAlias, {
      screenName: spec.screenName,
      role: spec.role,
    });
    slot.spec = structuredClone(spec);
    this.eventBroker?.emit({
      type: "screen-updated",
      data: slot.spec,
    });
    return slot.spec;
  }

  getContext(): BroadcastContextState {
    return structuredClone(this.context);
  }

  /**
   * Computes the current broadcast phase from pitube state & rundown progress.
   */
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

    const cueId = data["currentCueId"] ?? data["cueId"] ?? currentItem?.["id"];
    if (cueId !== undefined) {
      this.context.rundown.currentCueId = cueId;
      this.context.rundown.loaded = true;
    }
    const cueTitle = data["currentCueTitle"] ?? data["cueTitle"] ?? currentItem?.["title"];
    if (cueTitle !== undefined) {
      this.context.rundown.currentCueTitle = cueTitle;
    }
    const section =
      data["currentSection"] ??
      currentItem?.["section"] ??
      progress?.["section"]?.["title"] ??
      data["section"];
    if (section !== undefined) {
      this.context.rundown.currentSection = section;
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
  }): void {
    if (data.atemConnected !== undefined) this.context.hardware.atemConnected = data.atemConnected;
    if (data.programInput !== undefined) this.context.hardware.programInput = data.programInput;
    if (data.previewInput !== undefined) this.context.hardware.previewInput = data.previewInput;
    if (data.dwellSec !== undefined) this.context.hardware.dwellSec = data.dwellSec;
    if (data.camerasConnected !== undefined) {
      this.context.hardware.camerasConnected = data.camerasConnected;
    }
    if (data.voiceActive !== undefined) this.context.hardware.voiceActive = data.voiceActive;
    if (data.audioClassification !== undefined) {
      this.context.hardware.audioClassification = data.audioClassification;
    }
    if (data.tallyConnected !== undefined) {
      this.context.hardware.tallyConnected = data.tallyConnected;
    }
  }
}
