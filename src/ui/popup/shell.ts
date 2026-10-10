import { type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Focusable,
  isKeyRelease,
  Key,
  matchesKey,
  type TUI,
} from "@earendil-works/pi-tui";
import { box, hints, popupHeight, singleLine } from "./chrome.js";

export const POPUP_TABS = ["browse", "installed", "settings"] as const;
export type PopupTab = (typeof POPUP_TABS)[number];
export interface PopupSurface extends Component, Focusable {
  readonly searching?: boolean;
  setViewportHeight?(height: number): void;
  dispose?(): void;
}

type Slot = { controller: AbortController; surface?: PopupSurface; error?: string };

/** One overlay owns navigation, focus, async lifetimes and responsive chrome. */
export class PopupShell implements Component, Focusable {
  private readonly slots = new Map<PopupTab, Slot>();
  private _focused = false;
  private disposed = false;
  private finished = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    public tab: PopupTab,
    private readonly load: (tab: PopupTab, signal: AbortSignal) => Promise<PopupSurface>,
    private readonly onCancel: () => void
  ) {
    this.ensureLoaded(tab);
  }

  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    for (const [tab, slot] of this.slots)
      if (slot.surface) slot.surface.focused = value && tab === this.tab;
  }

  switchTab(tab: PopupTab): void {
    if (this.disposed || this.finished) return;
    const previous = this.slots.get(this.tab)?.surface;
    if (previous) previous.focused = false;
    this.tab = tab;
    this.ensureLoaded(tab);
    const surface = this.slots.get(tab)?.surface;
    if (surface) surface.focused = this.focused;
    this.tui.requestRender();
  }

  /** Called before done(): stop late async completions even if disposal is deferred. */
  finish(): void {
    this.finished = true;
    this.dispose();
  }

  handleInput(data: string): void {
    if (this.disposed || this.finished || isKeyRelease(data)) return;
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.tab)) {
      const delta = matchesKey(data, Key.shift("tab")) ? -1 : 1;
      const next =
        POPUP_TABS[(POPUP_TABS.indexOf(this.tab) + delta + POPUP_TABS.length) % POPUP_TABS.length];
      if (next) this.switchTab(next);
      return;
    }
    const slot = this.slots.get(this.tab);
    if (slot?.surface) slot.surface.handleInput?.(data);
    else if (this.keybindings.matches(data, "tui.select.cancel")) this.onCancel();
    else if (
      slot?.error &&
      (data === "r" || this.keybindings.matches(data, "tui.select.confirm"))
    ) {
      slot.controller.abort();
      this.slots.delete(this.tab);
      this.ensureLoaded(this.tab);
    }
    if (!this.disposed) this.tui.requestRender();
  }

  render(width: number): string[] {
    const height = popupHeight(this.tui.terminal.rows);
    if (height < 8)
      return box([this.theme.fg("muted", "Enlarge terminal · Esc close")], width, this.theme).slice(
        0,
        height
      );
    const inner = Math.max(1, width - 2);
    const bodyHeight = height - 6;
    const slot = this.slots.get(this.tab);
    const surface = slot?.surface;
    surface?.setViewportHeight?.(bodyHeight);
    const nav = POPUP_TABS.map((tab) => {
      const label = tab.charAt(0).toUpperCase() + tab.slice(1);
      return tab === this.tab
        ? this.theme.fg("accent", this.theme.bold(`[ ${label} ]`))
        : this.theme.fg("muted", `  ${label}  `);
    }).join(" ");
    const body = surface?.render(inner) ?? [
      "",
      this.theme.fg(
        slot?.error ? "error" : "muted",
        slot?.error ? `  ${slot.error} · r retry` : `  Loading ${this.tab}…`
      ),
    ];
    const clipped = body.slice(0, bodyHeight);
    while (clipped.length < bodyHeight) clipped.push("");
    const footer = surface?.searching
      ? hints(inner, [
          "  Enter search · Esc cancel search · Tab switch tab",
          "  Enter search · Esc back",
        ])
      : hints(
          inner,
          this.tab === "browse"
            ? [
                "  ↑↓ move · Enter actions · / search · g GitHub · r refresh · Tab tabs · Esc close",
                "  Enter actions · / search · g GitHub · Tab tabs · Esc close",
                "  / search · Tab tabs · Esc close",
              ]
            : this.tab === "installed"
              ? [
                  "  ↑↓ move · Enter actions · Space toggle/select · s save · g GitHub · Tab tabs · Esc close",
                  "  Enter actions · Space toggle · s save · Tab tabs · Esc close",
                  "  s save · Tab tabs · Esc close",
                ]
              : [
                  "  ↑↓ move · Enter open · / filter · Tab tabs · Esc close",
                  "  Enter open · Tab tabs · Esc close",
                ]
        );
    return box(
      [
        nav,
        this.theme.fg("borderMuted", "─".repeat(inner)),
        ...clipped,
        this.theme.fg("borderMuted", "─".repeat(inner)),
        this.theme.fg("dim", footer),
      ],
      width,
      this.theme
    );
  }

  invalidate(): void {
    for (const slot of this.slots.values()) slot.surface?.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.controller.abort();
      slot.surface?.dispose?.();
    }
  }

  private ensureLoaded(tab: PopupTab): void {
    if (this.slots.has(tab)) return;
    const slot: Slot = { controller: new AbortController() };
    this.slots.set(tab, slot);
    void Promise.resolve()
      .then(() => this.load(tab, slot.controller.signal))
      .then((surface) => {
        if (this.disposed || slot.controller.signal.aborted) {
          surface.dispose?.();
          return;
        }
        slot.surface = surface;
        surface.focused = this.focused && this.tab === tab;
        this.tui.requestRender();
      })
      .catch((error: unknown) => {
        if (this.disposed || slot.controller.signal.aborted) return;
        slot.error = singleLine(error instanceof Error ? error.message : String(error));
        this.tui.requestRender();
      });
  }
}
