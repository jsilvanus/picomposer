# picomposer (`D:\picomposer`)

Agentic Generative UI & Multi-Screen Workspace Composer for the **Raspberry Pi Production Ecosystem** (`piecosystem`).

`picomposer` establishes the agentic backend for broadcast-context-driven and operator-prompted UI composition using typed JSON schemas mapped to [`@piecosystem/piui`](file:///D:/piui/README.md) layout primitives (`Panel`, `Division`, `Hover`, `ScreenFrame`), molecules, and atoms.

---

## Two Distinct UI Agents

Neither agent in `picomposer` is the broadcast director ([`pidirector`](file:///D:/pidirector) owns shot selection and hardware switching). Instead, `picomposer` runs two specialized UI agents:

### 1. `ContextReactiveUiAgent` (`ui-context-composer`)
Proactively and reactively composes operator screens (`screen-1` / `copilot` and `screen-3` / `preflight`) based on live broadcast context:
- **When `pidirector` advises (`advisory` mode)**: Injects a prominent `hover` (`placement: "top-right"`, `tone: "advisory"`) and target camera preset/bus `panel` with one-tap `Accept` / `Dismiss` actions.
- **When `pidirector` directs (`autonomous` mode)**: Displays active shot rationale, dwell progress, prepared preview camera, steering note toggles, and `[ Take Manual Control ]`.
- **When the operator acts manually (`manual` mode / preemption)**: Pivots the workspace to manual ATEM bus & PTZ controls for the active camera/input plus `[ Continue AI ]`.
- **Setup & Preflight (`preflight` phase)**: Generates a guided setup flow checking `pitube` broadcast selection, `pirundown` loaded service, `pivoice` capture, and `atem`/`picam` status.
- **Standing UI Rules**: Automatically mounts/unmounts panels or hovers when rundown sections, cues, or broadcast states match persisted standing rules.

### 2. `PromptedUiCreatorAgent` (`ui-prompt-creator`)
On-demand workspace builder and standing-rule author prompted by the operator (`POST /api/v1/prompt`):
- Knows the full state of the broadcast (`pitube`, `pirundown`, `pidirector`, `pigateway`) and the `@piecosystem/piui` component catalog.
- **Standing Requests**: Prompts like *"Add graphics buttons here during sermon"* compile into persistent `StandingUiRule` entries saved to `data/standing-rules.json` (or `broadcast`-scoped temporary rules).
- **Immediate Multi-Screen Workspaces**: Prompts like *"Give me Camera 2 PTZ controls and tally cues on screen-2"* generate a typed JSON `UiScreenSpec` on the target screen slot.

---

## Multi-Screen Addressing

- `screen-1` (aliases: `copilot`, `advisory`, `director`): Context-Reactive Director Co-Pilot View
- `screen-2` (aliases: `operator`, `workspace`, `custom`): Prompted Operator Workspace
- `screen-3` (aliases: `preflight`, `setup`): Setup, Preflight & Rundown Overview
- Any ad-hoc screen ID (e.g. `/api/v1/screens/tablet-cam2`) is automatically registered on demand.
