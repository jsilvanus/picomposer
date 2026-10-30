import {
  renderButton,
  renderDivision,
  renderDocumentLayout,
  renderHover,
  renderPanel,
  renderScreenFrame,
} from "@piecosystem/piui";
import { renderPiuiComponent } from "../catalog/component-catalog.js";
import type {
  LastMessageContext,
  MouseSelectionContext,
  UiActionButton,
  UiComponentNode,
  UiPanelNode,
  UiScreenSpec,
} from "../schema/ui-schema.js";
import {
  evaluateVisibilityCondition,
  isNotExpired,
  type BroadcastContextState,
  type PageRegistrySummary,
} from "../state/composer-state.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSec(sec: number): string {
  const abs = Math.max(0, Math.floor(Math.abs(sec)));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sec < 0 ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderActionButtonHtml(btn: UiActionButton, ctx: BroadcastContextState): string {
  const visible =
    evaluateVisibilityCondition(btn.condition, ctx) && isNotExpired(btn.expiresAt);
  const condAttr = btn.condition
    ? ` data-condition-operator="${escapeHtml(btn.condition.operator)}" data-condition-section="${escapeHtml(btn.condition.section ?? "")}"`
    : "";
  const timerAttr = btn.expiresAt
    ? ` data-expires-at="${escapeHtml(btn.expiresAt)}" data-show-for-sec="${btn.showForSec ?? ""}"`
    : "";
  const hiddenAttr = visible ? "" : ' hidden data-conditional-hidden="true"';
  const macroAttr =
    btn.steps && btn.steps.length > 0
      ? ` data-macro-steps="${escapeHtml(JSON.stringify(btn.steps))}"`
      : "";
  const targetsAttr =
    btn.targets && btn.targets.length > 0
      ? ` data-action-targets="${escapeHtml(JSON.stringify(btn.targets))}"`
      : "";

  const timerBadge = btn.showForSec
    ? ` <span class="gui-timed-badge" data-countdown-expires="${escapeHtml(btn.expiresAt ?? "")}">⏱ ${formatSec(btn.showForSec)}</span>`
    : "";

  return `<span class="gui-action-wrap"${condAttr}${timerAttr}${hiddenAttr}${macroAttr}${targetsAttr} data-action-id="${escapeHtml(btn.id)}" data-action-name="${escapeHtml(btn.action)}">${renderButton({
    label: btn.label,
    variant: btn.variant,
    icon: btn.icon,
    dataAttributes: { actionId: btn.id, action: btn.action },
  })}${timerBadge}</span>`;
}

function renderTimeSeriesChartSvg(comp: UiComponentNode): string {
  const props = comp.props ?? {};
  const metric = String(props["metric"] ?? "audio_rms_dbfs");
  const label = String(props["label"] ?? metric);
  const unit = String(props["unit"] ?? "");
  const min = typeof props["min"] === "number" ? props["min"] : 0;
  const max = typeof props["max"] === "number" ? props["max"] : 100;
  const points = Array.isArray(props["points"])
    ? (props["points"] as Array<{ ts: string; value: number }>)
    : [];

  const width = 460;
  const height = 120;
  const padX = 12;
  const padY = 16;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const span = Math.max(1e-6, max - min);

  const coords = points.map((pt, idx) => {
    const x =
      points.length <= 1
        ? padX + plotW / 2
        : padX + (idx / (points.length - 1)) * plotW;
    const clamped = Math.max(min, Math.min(max, Number(pt.value) || 0));
    const y = padY + plotH - ((clamped - min) / span) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const latest = points.length > 0 ? points[points.length - 1]!.value : 0;
  const polyline =
    coords.length >= 2
      ? `<polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${coords.join(" ")}" />`
      : "";

  return `<div class="gui-timeseries-chart" data-metric="${escapeHtml(metric)}">
    <div class="gui-chart-header">
      <span class="gui-chart-title">${escapeHtml(label)}</span>
      <span class="gui-chart-latest"><strong>${latest}</strong> ${escapeHtml(unit)}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" class="gui-chart-svg" role="img" aria-label="${escapeHtml(label)} time series chart">
      <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="rgba(148,163,184,0.2)" />
      <line x1="${padX}" y1="${padY + plotH / 2}" x2="${width - padX}" y2="${padY + plotH / 2}" stroke="rgba(148,163,184,0.15)" stroke-dasharray="4 4" />
      <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="rgba(148,163,184,0.2)" />
      ${polyline}
    </svg>
    <div class="gui-chart-footer">
      <span>Min: ${min} ${escapeHtml(unit)}</span>
      <span>Samples: ${points.length}</span>
      <span>Max: ${max} ${escapeHtml(unit)}</span>
    </div>
  </div>`;
}

function renderComponentHtml(comp: UiComponentNode, ctx: BroadcastContextState): string {
  const visible =
    evaluateVisibilityCondition(comp.condition, ctx) && isNotExpired(comp.expiresAt);
  const condAttr = comp.condition
    ? ` data-condition-operator="${escapeHtml(comp.condition.operator)}" data-condition-section="${escapeHtml(comp.condition.section ?? "")}"`
    : "";
  const expAttr = comp.expiresAt
    ? ` data-expires-at="${escapeHtml(comp.expiresAt)}" data-show-for-sec="${comp.showForSec ?? ""}"`
    : "";
  const hiddenAttr = visible ? "" : ' hidden data-conditional-hidden="true"';

  const props = comp.props ?? {};
  let inner = "";

  switch (comp.component) {
    case "timeseries-chart":
      inner = renderTimeSeriesChartSvg(comp);
      break;

    case "timer-display": {
      const mode = String(props["mode"] ?? "rundown");
      const scope = String(props["scope"] ?? "item");
      const label = String(props["label"] ?? `Timer (${scope})`);
      const durationSec = Number(props["setDurationSec"] ?? ctx.rundown.timerSec ?? 180);
      const startedAt = String(props["startedAt"] ?? ctx.itemStartedAt);
      const overtime = Boolean(props["overtime"] ?? ctx.rundown.overtime);
      inner = `<div class="gui-timer-display ${overtime ? "is-overtime" : ""}" data-timer-mode="${escapeHtml(mode)}" data-timer-scope="${escapeHtml(scope)}" data-timer-duration-sec="${durationSec}" data-timer-started-at="${escapeHtml(startedAt)}">
        <div class="gui-timer-meta">
          <span class="gui-timer-badge">${escapeHtml(mode.toUpperCase())} • ${escapeHtml(scope.toUpperCase())}</span>
          <span class="gui-timer-label">${escapeHtml(label)}</span>
        </div>
        <div class="gui-timer-digits" data-timer-readout>${formatSec(durationSec)}</div>
      </div>`;
      break;
    }

    case "macro-button": {
      const steps = Array.isArray(props["steps"])
        ? (props["steps"] as Array<{ id: string; label: string; action: string }>)
        : [];
      const label = String(props["label"] ?? "Execute Macro");
      inner = `<div class="gui-macro-card" data-macro-steps="${escapeHtml(JSON.stringify(steps))}">
        <div class="gui-macro-header">
          <span class="gui-macro-badge">⚡ MACRO (${steps.length} steps)</span>
          <strong>${escapeHtml(label)}</strong>
        </div>
        <ol class="gui-macro-steps">
          ${steps.map((s) => `<li><code>${escapeHtml(s.action)}</code> — ${escapeHtml(s.label)}</li>`).join("")}
        </ol>
      </div>`;
      break;
    }

    case "wireless-mic-bank": {
      const channels = Array.isArray(props["channels"])
        ? (props["channels"] as Array<{ channel: number; label: string; volumePercent: number; muted?: boolean }>)
        : [];
      inner = `<div class="gui-wireless-mic-bank">
        ${channels
          .map(
            (ch) => `<div class="gui-mic-strip" data-mic-channel="${ch.channel}">
              <div class="gui-mic-title">🎙 ${escapeHtml(ch.label || `Wireless Mic ${ch.channel}`)}</div>
              <input type="range" min="0" max="100" value="${Number(ch.volumePercent ?? 80)}" aria-label="${escapeHtml(ch.label || `Wireless Mic ${ch.channel}`)} level" />
              <span class="gui-mic-val">${Number(ch.volumePercent ?? 80)}%</span>
            </div>`
          )
          .join("")}
      </div>`;
      break;
    }

    case "audio-fader": {
      const name = String(props["name"] ?? props["id"] ?? "Mic");
      const vol = Number(props["volumePercent"] ?? 80);
      inner = `<div class="gui-fader-row">
        <span>🎚 ${escapeHtml(name)}</span>
        <input type="range" min="0" max="100" value="${vol}" aria-label="${escapeHtml(name)} fader" />
        <span>${vol}%</span>
      </div>`;
      break;
    }

    case "atem-bus-selector": {
      const pgm = Number(props["programInput"] ?? ctx.hardware.programInput);
      const pvw = Number(props["previewInput"] ?? ctx.hardware.previewInput);
      inner = `<div class="gui-atem-bus">
        <div class="gui-bus-row">
          <span class="gui-bus-label">PGM</span>
          ${[1, 2, 3, 4]
            .map(
              (n) =>
                `<button type="button" class="gui-bus-btn ${n === pgm ? "is-pgm" : ""}" data-bus="pgm" data-input="${n}">Cam ${n}</button>`
            )
            .join("")}
        </div>
        <div class="gui-bus-row">
          <span class="gui-bus-label">PVW</span>
          ${[1, 2, 3, 4]
            .map(
              (n) =>
                `<button type="button" class="gui-bus-btn ${n === pvw ? "is-pvw" : ""}" data-bus="pvw" data-input="${n}">Cam ${n}</button>`
            )
            .join("")}
        </div>
      </div>`;
      break;
    }

    case "graphics-lower-third-panel": {
      const title = String(props["title"] ?? ctx.rundown.currentCueTitle ?? "Saarna");
      const subtitle = String(props["subtitle"] ?? ctx.rundown.assignedSpeaker ?? "");
      inner = `<div class="gui-lower-third-card">
        <div class="gui-lt-preview">
          <div class="gui-lt-title">${escapeHtml(title)}</div>
          <div class="gui-lt-sub">${escapeHtml(subtitle)}</div>
        </div>
      </div>`;
      break;
    }

    default: {
      const piuiHtml = renderPiuiComponent(comp.component, props);
      if (piuiHtml) {
        inner = piuiHtml;
      } else {
        const entries = Object.entries(props)
          .slice(0, 6)
          .map(
            ([k, v]) =>
              `<div class="gui-kv"><span>${escapeHtml(k)}:</span> <strong>${escapeHtml(
                typeof v === "object" ? JSON.stringify(v) : String(v)
              )}</strong></div>`
          )
          .join("");
        inner = `<div class="gui-generic-comp">
          <div class="gui-comp-type">${escapeHtml(comp.component)}</div>
          ${entries}
        </div>`;
      }
      break;
    }
  }

  const actionsHtml =
    comp.actions && comp.actions.length > 0
      ? `<div class="gui-comp-actions">${comp.actions.map((a) => renderActionButtonHtml(a, ctx)).join("")}</div>`
      : "";

  return `<div class="gui-component-node" id="${escapeHtml(comp.id)}" data-component-id="${escapeHtml(comp.id)}" data-component-type="${escapeHtml(comp.component)}"${condAttr}${expAttr}${hiddenAttr}>
    ${inner}
    ${actionsHtml}
  </div>`;
}

function renderPanelHtml(panel: UiPanelNode, ctx: BroadcastContextState): string {
  const visible =
    evaluateVisibilityCondition(panel.condition, ctx) && isNotExpired(panel.expiresAt);
  const condAttr = panel.condition
    ? ` data-condition-operator="${escapeHtml(panel.condition.operator)}" data-condition-section="${escapeHtml(panel.condition.section ?? "")}"`
    : "";
  const expAttr = panel.expiresAt
    ? ` data-expires-at="${escapeHtml(panel.expiresAt)}" data-show-for-sec="${panel.showForSec ?? ""}"`
    : "";
  const rectAttr = panel.rectHint
    ? ` data-rect-hint="${escapeHtml(JSON.stringify(panel.rectHint))}"`
    : "";
  const hiddenAttr = visible ? "" : ' hidden data-conditional-hidden="true"';

  const condBadge = panel.condition
    ? `<span class="gui-cond-badge">Condition: ${escapeHtml(panel.condition.operator)} ${escapeHtml(panel.condition.section ?? "")}</span>`
    : "";
  const timedBadge = panel.showForSec
    ? `<span class="gui-timed-badge" data-countdown-expires="${escapeHtml(panel.expiresAt ?? "")}">⏱ Show for ${formatSec(panel.showForSec)}</span>`
    : "";

  const actionsHtml = panel.actions.map((a) => renderActionButtonHtml(a, ctx)).join("");
  const bodyHtml = `${condBadge}${timedBadge}${panel.children
    .map((c) => renderComponentHtml(c, ctx))
    .join("")}`;

  const renderedPanel = renderPanel({
    id: panel.id,
    title: panel.title,
    subtitle: panel.subtitle,
    icon: panel.icon,
    tone: panel.tone,
    sourceLabel: panel.sourceLabel,
    collapsible: panel.collapsible,
    collapsed: panel.collapsed,
    actionsHtml,
    content: bodyHtml,
  });

  return `<div class="gui-panel-wrap" data-panel-id="${escapeHtml(panel.id)}" data-panel-title="${escapeHtml(panel.title)}"${condAttr}${expAttr}${rectAttr}${hiddenAttr}>${renderedPanel}</div>`;
}

export interface RenderGuiPageOptions {
  spec: UiScreenSpec;
  context: BroadcastContextState;
  mouseContext: MouseSelectionContext;
  lastMessageContext: LastMessageContext | null;
  pages: PageRegistrySummary[];
  savedComponentNames: string[];
}

export function renderGuiPageHtml(options: RenderGuiPageOptions): string {
  const { spec, context, mouseContext, lastMessageContext, pages, savedComponentNames } = options;

  const hoversHtml = spec.hovers
    .map((h) =>
      renderHover({
        id: h.id,
        title: h.title,
        subtitle: h.subtitle,
        icon: h.icon,
        placement: h.placement,
        tone: h.tone,
        badgeLabel: h.badgeLabel,
        dismissible: h.dismissible,
        actionsHtml: h.actions.map((a) => renderActionButtonHtml(a, context)).join(""),
        content: h.children.map((c) => renderComponentHtml(c, context)).join(""),
      })
    )
    .join("");

  let workspaceBodyHtml = "";
  if (spec.layoutMode === "document") {
    const allPanels = spec.divisions.flatMap((d) => d.slots.flatMap((s) => s.panels));
    workspaceBodyHtml = `<div class="piui-document-layout">${renderDocumentLayout({
      id: `doc-${spec.pageName}-${spec.viewNumber}`,
      title: spec.screenName,
      subtitle: `${context.pitube.title ?? context.rundown.title ?? "Live Broadcast"} • ${context.rundown.placeInEvent ?? spec.broadcastPhase}`,
      showToc: true,
      sections: allPanels.map((p) => ({
        id: p.id,
        title: p.title,
        subtitle: p.subtitle,
        badgeLabel: p.condition
          ? `${p.condition.operator} ${p.condition.section ?? ""}`
          : p.sourceLabel,
        content: renderPanelHtml(p, context),
      })),
    })}</div>`;
  } else {
    const divisionsHtml = spec.divisions
      .map((div) =>
        renderDivision({
          id: div.id,
          direction: div.direction,
          columns: div.columns,
          gap: div.gap,
          divided: div.divided,
          slots: div.slots.map((slot) => ({
            id: slot.id,
            label: slot.label,
            colSpan: slot.colSpan,
            content: slot.panels.map((p) => renderPanelHtml(p, context)).join(""),
          })),
        })
      )
      .join("");

    workspaceBodyHtml = renderScreenFrame({
      screenId: spec.screenId,
      screenName: `${spec.screenName} (/gui/${spec.pageName}/${spec.viewNumber})`,
      role: spec.role,
      broadcastPhase: spec.broadcastPhase,
      directorMode: spec.directorMode,
      placeInEvent: context.rundown.placeInEvent ?? undefined,
      activeSection: context.rundown.currentSection ?? undefined,
      standingRulesActiveCount: spec.activeStandingRuleIds.length,
      bodyHtml: divisionsHtml,
      hoversHtml,
    });
  }

  const mouseBound =
    mouseContext.mode !== "none" &&
    mouseContext.pageName === spec.pageName &&
    mouseContext.viewNumber === spec.viewNumber;

  const mouseChipLabel =
    mouseContext.mode === "component"
      ? `Mouse: Component ${mouseContext.componentId ?? mouseContext.panelId ?? ""}`
      : mouseContext.mode === "rectangle" && mouseContext.rect
        ? `Mouse: Area ${mouseContext.rect.width}×${mouseContext.rect.height} (${(mouseContext.overlappingComponentIds?.length ?? 0) + (mouseContext.overlappingPanelIds?.length ?? 0)} items)`
        : "Mouse: None";

  const pagesNavHtml = pages
    .map(
      (p) =>
        `<div class="gui-page-group">
          <span class="gui-page-name">Page <strong>${escapeHtml(p.pageName)}</strong>:</span>
          ${p.views
            .map(
              (v) =>
                `<a href="${escapeHtml(v.route)}" class="gui-view-link ${
                  p.pageName === spec.pageName && v.viewNumber === spec.viewNumber ? "is-active" : ""
                }">View ${v.viewNumber}</a>`
            )
            .join("")}
        </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(spec.screenName)} — /gui/${escapeHtml(spec.pageName)}/${spec.viewNumber}</title>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      margin: 0;
      background: #090d16;
      color: #f8fafc;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }
    /* The ONLY permanent element on /gui/:name/:number */
    #btn-ui-edit {
      position: fixed;
      bottom: 1.25rem;
      right: 1.25rem;
      z-index: 9999;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 1.1rem;
      border-radius: 999px;
      border: 1px solid rgba(56, 189, 248, 0.5);
      background: rgba(15, 23, 42, 0.92);
      color: #38bdf8;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      transition: transform 0.15s ease, background 0.15s ease;
    }
    #btn-ui-edit:hover {
      background: rgba(30, 41, 59, 0.98);
      transform: translateY(-1px);
    }
    body.ui-editing-active {
      cursor: crosshair;
      user-select: none;
    }
    body.ui-editing-active #btn-ui-edit {
      background: #0284c7;
      color: #ffffff;
      border-color: #7dd3fc;
    }
    body.ui-editing-active [data-component-id]:hover,
    body.ui-editing-active [data-panel-id]:hover {
      outline: 2px dashed #38bdf8;
      outline-offset: 3px;
    }
    [data-mouse-selected="true"] {
      outline: 2px solid #f59e0b !important;
      outline-offset: 3px;
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.2);
    }
    body.ui-editing-active [data-conditional-hidden="true"] {
      display: block !important;
      opacity: 0.45;
      border: 1px dashed #a855f7;
    }
    #ui-selection-rect {
      position: fixed;
      pointer-events: none;
      border: 2px dashed #38bdf8;
      background: rgba(56, 189, 248, 0.14);
      z-index: 9990;
      display: none;
    }
    /* Non-modal top-layer <dialog popover="manual"> per modern-web-guidance dialog Rule 2 */
    #ai-prompt-dialog {
      position: fixed;
      inset: auto 1.25rem 4.5rem auto;
      margin: 0;
      width: min(460px, calc(100vw - 2.5rem));
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 0.875rem;
      background: rgba(15, 23, 42, 0.96);
      color: #f8fafc;
      padding: 1rem;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(12px);
      z-index: 9998;
    }
    .ai-dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .ai-dialog-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #e2e8f0;
      margin: 0;
    }
    .ai-close-btn {
      background: transparent;
      border: 1px solid rgba(148, 163, 184, 0.3);
      color: #cbd5e1;
      border-radius: 0.375rem;
      padding: 0.25rem 0.5rem;
      cursor: pointer;
    }
    .ai-context-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
    }
    .ai-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.28rem 0.65rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: rgba(30, 41, 59, 0.8);
      color: #94a3b8;
      cursor: pointer;
    }
    .ai-chip[aria-pressed="true"],
    .ai-chip.is-bound {
      border-color: rgba(56, 189, 248, 0.6);
      background: rgba(2, 132, 199, 0.25);
      color: #7dd3fc;
    }
    .ai-prompt-input {
      width: 100%;
      box-sizing: border-box;
      min-height: 4.25rem;
      border-radius: 0.5rem;
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: rgba(9, 13, 22, 0.9);
      color: #f8fafc;
      padding: 0.6rem;
      font-size: 0.875rem;
      resize: vertical;
      margin-bottom: 0.6rem;
    }
    .ai-dialog-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }
    .ai-submit-btn {
      background: #0284c7;
      color: #fff;
      border: none;
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    .gui-pages-bar {
      margin-top: 0.75rem;
      padding-top: 0.6rem;
      border-top: 1px solid rgba(148, 163, 184, 0.15);
      font-size: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .gui-page-group {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: center;
    }
    .gui-view-link {
      color: #94a3b8;
      text-decoration: none;
      padding: 0.15rem 0.45rem;
      border-radius: 0.25rem;
      background: rgba(30, 41, 59, 0.6);
    }
    .gui-view-link.is-active {
      color: #38bdf8;
      background: rgba(2, 132, 199, 0.25);
      font-weight: 600;
    }
    .gui-timeseries-chart,
    .gui-timer-display,
    .gui-macro-card,
    .gui-wireless-mic-bank,
    .gui-fader-row,
    .gui-atem-bus,
    .gui-lower-third-card,
    .gui-generic-comp {
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 0.5rem;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .gui-chart-header, .gui-chart-footer {
      display: flex;
      justify-content: space-between;
      font-size: 0.78rem;
      color: #cbd5e1;
    }
    .gui-chart-svg {
      width: 100%;
      height: auto;
      display: block;
      margin: 0.35rem 0;
    }
    .gui-timer-digits {
      font-size: 2rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: #38bdf8;
      margin-top: 0.25rem;
    }
    .gui-timer-display.is-overtime .gui-timer-digits {
      color: #ef4444;
    }
    .gui-cond-badge, .gui-timed-badge {
      display: inline-block;
      font-size: 0.72rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      margin-right: 0.4rem;
      margin-bottom: 0.4rem;
      background: rgba(168, 85, 247, 0.2);
      color: #d8b4fe;
      border: 1px solid rgba(168, 85, 247, 0.4);
    }
    .gui-bus-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.35rem;
    }
    .gui-bus-btn {
      padding: 0.35rem 0.65rem;
      border-radius: 0.375rem;
      border: 1px solid rgba(148, 163, 184, 0.25);
      background: #1e293b;
      color: #e2e8f0;
      cursor: pointer;
    }
    .gui-bus-btn.is-pgm { background: #dc2626; color: #fff; border-color: #f87171; }
    .gui-bus-btn.is-pvw { background: #16a34a; color: #fff; border-color: #4ade80; }
  </style>
</head>
<body data-page-name="${escapeHtml(spec.pageName)}" data-view-number="${spec.viewNumber}" data-screen-id="${escapeHtml(spec.screenId)}" data-layout-mode="${escapeHtml(spec.layoutMode)}">
  <main id="gui-workspace-root">
    ${workspaceBodyHtml}
  </main>

  <div id="ui-selection-rect" aria-hidden="true"></div>

  <!-- Permanent UI Editing Activation Button -->
  <button type="button" id="btn-ui-edit" aria-controls="ai-prompt-dialog" aria-expanded="false">
    <span>✦ Edit UI (@ai)</span>
  </button>

  <!-- Non-Modal Top-Layer @ai Prompt Dialog (popover="manual" keeps page interactive for component click & rectangle drag) -->
  <dialog id="ai-prompt-dialog" popover="manual" aria-labelledby="ai-prompt-title">
    <div class="ai-dialog-header">
      <h2 id="ai-prompt-title" class="ai-dialog-title">@ai Generative UI Composer — /gui/${escapeHtml(spec.pageName)}/${spec.viewNumber}</h2>
      <button type="button" id="btn-ai-close" class="ai-close-btn" aria-label="Close AI prompt window">Close</button>
    </div>

    <div class="ai-context-chips" role="group" aria-label="Prompt Context Chips">
      <button type="button" id="chip-broadcast-ctx" class="ai-chip" aria-pressed="true" data-chip="broadcast">
        <span>📡 Broadcast Context: <strong data-state-label>ON</strong></span>
      </button>

      <button type="button" id="chip-mouse-ctx" class="ai-chip ${mouseBound ? "is-bound" : ""}" data-chip="mouse" ${mouseBound ? "" : "hidden"}>
        <span id="chip-mouse-label">🎯 ${escapeHtml(mouseChipLabel)}</span>
        <span aria-hidden="true">×</span>
      </button>

      <button type="button" id="chip-last-msg-ctx" class="ai-chip" aria-pressed="${lastMessageContext ? "true" : "false"}" data-chip="last-message" title="${escapeHtml(lastMessageContext?.prompt ?? "No previous message yet")}">
        <span>💬 Last Message: <strong data-state-label>${lastMessageContext ? "ON" : "OFF"}</strong></span>
      </button>
    </div>

    <form id="ai-prompt-form">
      <textarea
        id="ai-prompt-textarea"
        class="ai-prompt-input"
        placeholder="Click a component ('Remove this'), drag a rectangle ('add here sound controls for wireless mics 1,2,5'), or ask @ai for macros, timers, charts, or 'save these as sermon controls'..."
        required
      ></textarea>
      <div class="ai-dialog-footer">
        <span id="ai-status-msg" style="font-size:0.75rem;color:#94a3b8;">Click component or drag rectangle on canvas</span>
        <button type="submit" id="btn-ai-submit" class="ai-submit-btn">Send to @ai</button>
      </div>
    </form>

    <div class="gui-pages-bar">
      ${pagesNavHtml}
      ${
        savedComponentNames.length > 0
          ? `<div class="gui-page-group"><span>Saved Components:</span> ${savedComponentNames
              .map((n) => `<code>${escapeHtml(n)}</code>`)
              .join(" ")}</div>`
          : ""
      }
    </div>
  </dialog>

  <script>
    (() => {
      const pageName = document.body.dataset.pageName || "1";
      const viewNumber = Number(document.body.dataset.viewNumber || "1");
      const screenId = document.body.dataset.screenId || "screen-1";

      const editBtn = document.getElementById("btn-ui-edit");
      const dialog = document.getElementById("ai-prompt-dialog");
      const closeBtn = document.getElementById("btn-ai-close");
      const rectEl = document.getElementById("ui-selection-rect");

      const chipBroadcast = document.getElementById("chip-broadcast-ctx");
      const chipMouse = document.getElementById("chip-mouse-ctx");
      const chipMouseLabel = document.getElementById("chip-mouse-label");
      const chipLastMsg = document.getElementById("chip-last-msg-ctx");
      const form = document.getElementById("ai-prompt-form");
      const textarea = document.getElementById("ai-prompt-textarea");
      const statusMsg = document.getElementById("ai-status-msg");

      let editing = false;
      let dragStart = null;

      function setEditingMode(next) {
        editing = next;
        document.body.classList.toggle("ui-editing-active", editing);
        editBtn.setAttribute("aria-expanded", String(editing));
        if (editing) {
          if (typeof dialog.showPopover === "function") {
            try { dialog.showPopover(); } catch {}
          } else {
            dialog.setAttribute("open", "");
          }
        } else {
          if (typeof dialog.hidePopover === "function") {
            try { dialog.hidePopover(); } catch {}
          } else {
            dialog.removeAttribute("open");
          }
          rectEl.style.display = "none";
        }
      }

      editBtn.addEventListener("click", () => setEditingMode(!editing));
      closeBtn.addEventListener("click", () => setEditingMode(false));

      function toggleChip(chip) {
        const pressed = chip.getAttribute("aria-pressed") === "true";
        const next = !pressed;
        chip.setAttribute("aria-pressed", String(next));
        const lbl = chip.querySelector("[data-state-label]");
        if (lbl) lbl.textContent = next ? "ON" : "OFF";
      }

      chipBroadcast.addEventListener("click", () => toggleChip(chipBroadcast));
      chipLastMsg.addEventListener("click", () => toggleChip(chipLastMsg));

      chipMouse.addEventListener("click", async () => {
        await fetch("/api/v1/context/mouse", { method: "DELETE" });
        chipMouse.hidden = true;
        chipMouse.classList.remove("is-bound");
        document.querySelectorAll("[data-mouse-selected]").forEach((el) => el.removeAttribute("data-mouse-selected"));
        rectEl.style.display = "none";
      });

      // Mouse selection (click component OR drag rectangle) while in UI Editing Mode
      const workspace = document.getElementById("gui-workspace-root");
      workspace.addEventListener("mousedown", (e) => {
        if (!editing) return;
        dragStart = { x: e.clientX, y: e.clientY };
        rectEl.style.left = dragStart.x + "px";
        rectEl.style.top = dragStart.y + "px";
        rectEl.style.width = "0px";
        rectEl.style.height = "0px";
      });

      window.addEventListener("mousemove", (e) => {
        if (!editing || !dragStart) return;
        const dx = Math.abs(e.clientX - dragStart.x);
        const dy = Math.abs(e.clientY - dragStart.y);
        if (dx > 8 || dy > 8) {
          rectEl.style.display = "block";
          rectEl.style.left = Math.min(dragStart.x, e.clientX) + "px";
          rectEl.style.top = Math.min(dragStart.y, e.clientY) + "px";
          rectEl.style.width = dx + "px";
          rectEl.style.height = dy + "px";
        }
      });

      window.addEventListener("mouseup", async (e) => {
        if (!editing || !dragStart) return;
        const start = dragStart;
        dragStart = null;
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);

        document.querySelectorAll("[data-mouse-selected]").forEach((el) => el.removeAttribute("data-mouse-selected"));

        if (dx > 14 && dy > 14) {
          // Rectangle area selection
          const rect = {
            x: Math.round(Math.min(start.x, e.clientX)),
            y: Math.round(Math.min(start.y, e.clientY)),
            width: Math.round(dx),
            height: Math.round(dy),
          };
          const overlappingComponentIds = [];
          const overlappingPanelIds = [];

          document.querySelectorAll("[data-component-id]").forEach((el) => {
            const b = el.getBoundingClientRect();
            if (b.right >= rect.x && b.left <= rect.x + rect.width && b.bottom >= rect.y && b.top <= rect.y + rect.height) {
              overlappingComponentIds.push(el.getAttribute("data-component-id"));
              el.setAttribute("data-mouse-selected", "true");
            }
          });
          document.querySelectorAll("[data-panel-id]").forEach((el) => {
            const b = el.getBoundingClientRect();
            if (b.right >= rect.x && b.left <= rect.x + rect.width && b.bottom >= rect.y && b.top <= rect.y + rect.height) {
              overlappingPanelIds.push(el.getAttribute("data-panel-id"));
            }
          });

          await fetch("/api/v1/context/mouse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "rectangle",
              pageName,
              viewNumber,
              rect,
              overlappingComponentIds,
              overlappingPanelIds,
            }),
          });
          chipMouseLabel.textContent = "🎯 Mouse: Area " + rect.width + "×" + rect.height + " (" + overlappingComponentIds.length + " comps)";
          chipMouse.hidden = false;
          chipMouse.classList.add("is-bound");
        } else {
          // Component click selection
          rectEl.style.display = "none";
          const target = e.target.closest("[data-component-id], [data-panel-id]");
          if (!target) return;
          target.setAttribute("data-mouse-selected", "true");
          const componentId = target.getAttribute("data-component-id") || undefined;
          const componentType = target.getAttribute("data-component-type") || undefined;
          const panelEl = target.closest("[data-panel-id]");
          const panelId = panelEl ? panelEl.getAttribute("data-panel-id") : undefined;

          await fetch("/api/v1/context/mouse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "component",
              pageName,
              viewNumber,
              componentId,
              componentType,
              panelId,
              label: componentId || panelId,
            }),
          });
          chipMouseLabel.textContent = "🎯 Mouse: " + (componentId || panelId);
          chipMouse.hidden = false;
          chipMouse.classList.add("is-bound");
        }
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const prompt = textarea.value.trim();
        if (!prompt) return;
        statusMsg.textContent = "Composing UI...";
        const useBroadcastContext = chipBroadcast.getAttribute("aria-pressed") === "true";
        const useMouseContext = !chipMouse.hidden;
        const useLastMessageContext = chipLastMsg.getAttribute("aria-pressed") === "true";

        const res = await fetch("/api/v1/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            pageName,
            viewNumber,
            targetScreenId: screenId,
            useBroadcastContext,
            useMouseContext,
            useLastMessageContext,
          }),
        });
        if (res.ok) {
          window.location.reload();
        } else {
          statusMsg.textContent = "Error composing UI";
        }
      });

      // Button Action Dispatcher (forwarding targets to /api/v1/actions/dispatch)
      workspace.addEventListener("click", async (e) => {
        if (editing) return;
        const btn = e.target.closest("[data-action-targets]");
        if (!btn) return;
        const rawTargets = btn.getAttribute("data-action-targets");
        const actionId = btn.getAttribute("data-action-id") || undefined;
        if (rawTargets) {
          try {
            const targets = JSON.parse(rawTargets);
            await fetch("/api/v1/actions/dispatch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ targets, actionId, source: "gui_button" }),
            });
          } catch (err) {
            console.error("Failed to dispatch targets", err);
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}
