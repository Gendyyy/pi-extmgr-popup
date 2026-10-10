import assert from "node:assert/strict";
import test from "node:test";
import { type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey } from "@earendil-works/pi-tui";
import { PopupSettings, SETTINGS_ENTRIES, type SettingId } from "../src/ui/popup/settings.js";

const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const BINDINGS: Record<string, KeyId | KeyId[]> = {
  "tui.select.up": "up",
  "tui.select.down": "down",
  "tui.select.pageUp": "pageUp",
  "tui.select.pageDown": "pageDown",
  "tui.select.confirm": "enter",
  "tui.select.cancel": ["escape", "ctrl+c"],
};
const keys = {
  matches: (data: string, keybinding: string) => {
    const binding = BINDINGS[keybinding];
    if (!binding) return false;
    const list = Array.isArray(binding) ? binding : [binding];
    return list.some((key) => matchesKey(data, key));
  },
  getKeys: (keybinding: string) => {
    const binding = BINDINGS[keybinding];
    return binding ? (Array.isArray(binding) ? [...binding] : [binding]) : [];
  },
  getEffectiveConfig: () => ({ ...BINDINGS }),
} as unknown as KeybindingsManager;

function setup(status = "Disabled") {
  const actions: (SettingId | "cancel")[] = [];
  const settings = new PopupSettings(theme, keys, (id) => actions.push(id), status);
  settings.focused = true;
  return { settings, actions };
}

void test("settings tab lists every former subcommand with a description", () => {
  const { settings } = setup();
  settings.setViewportHeight(1000);
  const text = settings.render(100).join("\n");
  for (const entry of SETTINGS_ENTRIES) {
    assert.ok(text.includes(entry.label), entry.label);
    assert.ok(text.includes(entry.description), entry.description);
  }
  assert.ok(text.includes("Update checks: Disabled"));
  assert.ok(text.includes(`1–${SETTINGS_ENTRIES.length} of ${SETTINGS_ENTRIES.length} actions`));
});

void test("Enter runs the selected setting and arrows move the selection", () => {
  const { settings, actions } = setup();
  settings.handleInput("\r");
  assert.deepEqual(actions, ["auto-update"]);

  settings.handleInput("\u001b[B");
  settings.handleInput("\r");
  assert.deepEqual(actions, ["auto-update", "profile"]);
});

void test("selection wraps in both directions", () => {
  const { settings, actions } = setup();
  settings.handleInput("\u001b[A");
  settings.handleInput("\r");
  assert.deepEqual(actions, [SETTINGS_ENTRIES.at(-1)?.id]);
});

void test("filtering narrows the list and Enter runs the filtered action", () => {
  const { settings, actions } = setup();
  settings.handleInput("/");
  assert.equal(settings.searching, true);
  for (const char of "trash") settings.handleInput(char);

  const lines = settings.render(100);
  assert.ok(lines.some((line) => line.includes("Extension trash")));
  assert.ok(!lines.some((line) => line.includes("Clear metadata cache")));
  assert.ok(lines.some((line) => line.includes("1–1 of 1 actions")));

  // Enter commits the filter; a second Enter runs the selected action.
  settings.handleInput("\r");
  assert.equal(settings.searching, false);
  settings.handleInput("\r");
  assert.deepEqual(actions, ["trash"]);
});

void test("Escape clears an active filter before closing the popup", () => {
  const { settings, actions } = setup();
  settings.handleInput("/");
  for (const char of "zzz") settings.handleInput(char);
  assert.ok(settings.render(100).some((line) => line.includes("No matching settings")));

  settings.handleInput("\u001b");
  assert.deepEqual(actions, []);
  assert.equal(settings.searching, false);
  assert.ok(settings.render(100).some((line) => line.includes("1–8 of 17 actions")));

  settings.handleInput("\u001b");
  assert.deepEqual(actions, ["cancel"]);
});

void test("viewport height controls how many rows are visible", () => {
  const { settings } = setup();
  settings.setViewportHeight(11);
  assert.ok(settings.render(100).some((line) => line.includes("1–4 of 17 actions")));

  settings.setViewportHeight(1000);
  assert.ok(settings.render(100).some((line) => line.includes("1–17 of 17 actions")));
});

void test("search focus follows component focus", () => {
  const { settings } = setup();
  settings.handleInput("/");
  assert.equal(settings.searching, true);
  settings.focused = false;
  settings.focused = true;
  assert.equal(settings.searching, true);
  settings.handleInput("\u001b");
  assert.equal(settings.searching, false);
});
