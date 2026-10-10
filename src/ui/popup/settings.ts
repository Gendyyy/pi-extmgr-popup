import { type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { type CommandId } from "../../commands/types.js";
import { getCenteredVisibleRange, moveListSelection } from "../list-navigation.js";
import { type PopupSurface } from "./shell.js";

export type SettingId = CommandId | "health" | "reload" | "help";
export const SETTINGS_ENTRIES: readonly { id: SettingId; label: string; description: string }[] = [
  {
    id: "auto-update",
    label: "Scheduled update checks",
    description: "Choose an interval, check now, or disable scheduled checks.",
  },
  {
    id: "profile",
    label: "Profiles",
    description: "Save, import, export, compare, apply and recover package profiles.",
  },
  {
    id: "health",
    label: "Health & diagnostics",
    description: "Inspect compatibility, extension state and runtime conflicts.",
  },
  {
    id: "doctor",
    label: "Doctor",
    description: "Report command/tool ownership and installed package compatibility.",
  },
  {
    id: "history",
    label: "Change history",
    description: "Browse successful and failed installs, updates and extension changes.",
  },
  {
    id: "trash",
    label: "Extension trash",
    description: "List, restore or permanently purge removed local extensions.",
  },
  {
    id: "clear-cache",
    label: "Clear metadata cache",
    description: "Clear cached npm metadata and search results.",
  },
  {
    id: "install",
    label: "Install by source",
    description: "Install an npm package, Git repository or local path.",
  },
  {
    id: "remove",
    label: "Remove a package",
    description: "Choose an installed package to remove (confirmation required).",
  },
  {
    id: "update",
    label: "Update packages",
    description: "Preview or update selected packages, or update all.",
  },
  {
    id: "list",
    label: "List local extensions",
    description: "Read-only report of local extension paths and enabled states.",
  },
  {
    id: "installed",
    label: "Installed packages",
    description: "Open the Installed tab to configure packages and local extensions.",
  },
  {
    id: "local",
    label: "Local extensions",
    description: "Open the Installed tab; filter with 2 to show local extensions.",
  },
  {
    id: "remote",
    label: "Browse community packages",
    description: "Open the Browse tab (also replaces the packages alias).",
  },
  {
    id: "search",
    label: "Search npm",
    description: "Search by package name or keyword, including non-gallery packages.",
  },
  {
    id: "reload",
    label: "Reload pi",
    description: "Apply pending extension changes without restarting pi.",
  },
  {
    id: "help",
    label: "Keyboard shortcuts",
    description: "Show management shortcuts and usage help.",
  },
];

export class PopupSettings implements PopupSurface {
  private readonly input = new Input();
  private searchActive = false;
  private selected = 0;
  private maxVisible = 8;
  private _focused = false;
  constructor(
    private readonly theme: Theme,
    private readonly keys: KeybindingsManager,
    private readonly onAction: (id: SettingId | "cancel") => void,
    private readonly status: string
  ) {}
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this.searchActive;
  }
  get searching(): boolean {
    return this.searchActive;
  }
  setViewportHeight(height: number): void {
    this.maxVisible = Math.max(1, Math.floor((height - 3) / 2));
  }
  invalidate(): void {
    this.input.invalidate();
  }
  private entries() {
    const query = this.input.getValue().trim().toLowerCase();
    return SETTINGS_ENTRIES.filter((entry) =>
      `${entry.label} ${entry.description} ${entry.id}`.toLowerCase().includes(query)
    );
  }
  handleInput(data: string): void {
    if (this.searchActive) {
      if (this.keys.matches(data, "tui.select.cancel")) {
        this.searchActive = false;
        this.input.setValue("");
        this.input.focused = false;
      } else if (this.keys.matches(data, "tui.select.confirm")) {
        this.searchActive = false;
        this.input.focused = false;
      } else {
        this.input.handleInput(data);
        this.selected = 0;
      }
      return;
    }
    if (data === "/" || matchesKey(data, Key.ctrl("f"))) {
      this.searchActive = true;
      this.input.focused = this.focused;
      return;
    }
    const entries = this.entries();
    if (this.keys.matches(data, "tui.select.up"))
      this.selected = moveListSelection(this.selected, -1, entries.length, { wrap: true });
    else if (this.keys.matches(data, "tui.select.down"))
      this.selected = moveListSelection(this.selected, 1, entries.length, { wrap: true });
    else if (this.keys.matches(data, "tui.select.pageUp"))
      this.selected = moveListSelection(this.selected, -this.maxVisible, entries.length);
    else if (this.keys.matches(data, "tui.select.pageDown"))
      this.selected = moveListSelection(this.selected, this.maxVisible, entries.length);
    else if (matchesKey(data, Key.home)) this.selected = 0;
    else if (matchesKey(data, Key.end)) this.selected = Math.max(0, entries.length - 1);
    else if (this.keys.matches(data, "tui.select.confirm")) {
      const entry = entries[this.selected];
      if (entry) this.onAction(entry.id);
    } else if (this.keys.matches(data, "tui.select.cancel")) {
      if (this.input.getValue()) {
        this.input.setValue("");
        this.selected = 0;
      } else this.onAction("cancel");
    }
  }
  render(width: number): string[] {
    const entries = this.entries();
    this.selected = Math.min(this.selected, Math.max(0, entries.length - 1));
    const lines = this.searchActive
      ? this.input.render(width)
      : [this.theme.fg("muted", `  Update checks: ${this.status}`)];
    lines.push("");
    const { startIndex, endIndex } = getCenteredVisibleRange(
      this.selected,
      entries.length,
      this.maxVisible
    );
    for (let i = startIndex; i < endIndex; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const label = truncateToWidth(`${i === this.selected ? "› " : "  "}${entry.label}`, width);
      lines.push(
        i === this.selected
          ? this.theme.style(label, { bg: "selectedBg", fg: "text", bold: true })
          : label
      );
      lines.push(truncateToWidth(this.theme.fg("dim", `  ${entry.description}`), width));
    }
    if (!entries.length)
      lines.push(this.theme.fg("muted", "  No matching settings. Esc clears the filter."));
    lines.push(
      this.theme.fg(
        "dim",
        `  ${entries.length ? startIndex + 1 : 0}–${endIndex} of ${entries.length} actions`
      )
    );
    return lines;
  }
}
