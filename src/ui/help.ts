/**
 * Help display
 */
import { type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showReport } from "./report.js";

/** Keep help compact and scannable without repeating every footer hint. */
export function buildHelpLines(): string[] {
  return [
    "Opening the popup",
    "  /extensions          Open the extensions popup",
    "  Ctrl+Alt+E           Open the popup from anywhere",
    "",
    "Popup navigation",
    "  Tab / Shift+Tab      Cycle Browse · Installed · Settings",
    "  ↑↓ / PageUp/PageDown  Move through the current list",
    "  Enter                Open actions for the selected row",
    "  /                    Search or filter the current tab",
    "  g                    Open the selected package's GitHub repository",
    "  Esc                  Clear search, cancel, or close the popup",
    "",
    "Browse tab",
    "  Community packages from the pi gallery, plus npm search results",
    "  i install by source · r refresh · n/p page through results",
    "  Enter on a row opens install and npm-info actions",
    "",
    "Installed tab",
    "  Space                Toggle local extension or select package",
    "  Enter                Open actions for the selected item",
    "  1-4                  Filter: All / Local / Packages / Updates",
    "  5-7                  Filter: Disabled / Favorites / Recent",
    "  B                    Bulk actions for selected packages",
    "  u / U                Update selected package / all packages",
    "  X                    Remove the selected package or local extension",
    "  c / V                Configure entrypoints / view full details",
    "  S                    Save staged local-extension changes",
    "  W / L / D            Save / load / delete a manager view",
    "  *                    Toggle favorite",
    "",
    "Settings tab",
    "  Every /extensions subcommand now lives here as an action",
    "  ↑↓ then Enter runs the action; / narrows the list by name",
    "  Includes profiles, health, doctor, history, trash, cache,",
    "  install/remove/update, local extension reports, and reload",
    "",
    "Sources and safety",
    "  Every row shows its kind, scope, and effective state inline",
    "  Packages may be npm, git, or local sources",
    "  Missing compatibility or artifact-integrity evidence is unknown",
    "  Changes that affect loaded extensions show Reload required",
  ];
}

export async function showHelp(ctx: ExtensionCommandContext): Promise<void> {
  await showReport(ctx, { title: "Extensions Manager Help", lines: buildHelpLines() });
}
