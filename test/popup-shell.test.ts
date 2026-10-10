import assert from "node:assert/strict";
import test from "node:test";
import { type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { popupHeight } from "../src/ui/popup/chrome.js";
import { PopupShell, type PopupSurface, type PopupTab } from "../src/ui/popup/shell.js";

const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const BINDINGS: Record<string, KeyId | KeyId[]> = {
  "tui.select.up": "up",
  "tui.select.down": "down",
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

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function makeTui(rows = 40, columns = 100): { tui: TUI; renders: () => number } {
  let renders = 0;
  return {
    tui: {
      terminal: { rows, columns },
      requestRender: () => {
        renders += 1;
      },
    } as unknown as TUI,
    renders: () => renders,
  };
}

function makeSurface(label: string) {
  const state = {
    inputs: [] as string[],
    heights: [] as number[],
    disposed: 0,
    focused: false,
    searching: false,
  };
  const surface: PopupSurface = {
    get focused() {
      return state.focused;
    },
    set focused(value: boolean) {
      state.focused = value;
    },
    get searching() {
      return state.searching;
    },
    setViewportHeight: (height) => state.heights.push(height),
    render: () => [`SURFACE:${label}`],
    invalidate: () => undefined,
    handleInput: (data) => state.inputs.push(data),
    dispose: () => {
      state.disposed += 1;
    },
  };
  return { surface, state };
}

void test("shell renders the three tabs and marks the active one", async () => {
  const { tui } = makeTui();
  const { surface } = makeSurface("browse");
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () => Promise.resolve(surface),
    () => undefined
  );
  await flush();

  const lines = shell.render(90);
  assert.ok(lines[0]?.includes("Extensions"));
  assert.ok(lines[1]?.includes("[ Browse ]"));
  assert.ok(lines[1]?.includes("Installed"));
  assert.ok(lines[1]?.includes("Settings"));
  assert.ok(lines.some((line) => line.includes("SURFACE:browse")));
  assert.ok(lines.some((line) => line.includes("Tab tabs")));
  for (const line of lines) assert.ok(visibleWidth(line) <= 90, line);
  shell.dispose();
});

void test("shell gives the body exactly the popup height minus chrome", async () => {
  const { tui } = makeTui(30);
  const { surface, state } = makeSurface("browse");
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () => Promise.resolve(surface),
    () => undefined
  );
  await flush();

  const lines = shell.render(80);
  assert.equal(lines.length, popupHeight(30));
  assert.deepEqual(state.heights, [popupHeight(30) - 6]);
  shell.dispose();
});

void test("Tab and Shift+Tab cycle tabs, load lazily, and move focus", async () => {
  const { tui } = makeTui();
  const loaded: PopupTab[] = [];
  const surfaces = new Map<PopupTab, ReturnType<typeof makeSurface>>();
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    (tab) => {
      loaded.push(tab);
      const made = makeSurface(tab);
      surfaces.set(tab, made);
      return Promise.resolve(made.surface);
    },
    () => undefined
  );
  await flush();
  shell.focused = true;

  shell.handleInput("\t");
  await flush();
  assert.equal(shell.tab, "installed");
  assert.deepEqual(loaded, ["browse", "installed"]);
  assert.equal(surfaces.get("installed")?.state.focused, true);
  assert.equal(surfaces.get("browse")?.state.focused, false);

  shell.handleInput("\t");
  await flush();
  assert.equal(shell.tab, "settings");

  shell.handleInput("\t");
  await flush();
  assert.equal(shell.tab, "browse");
  assert.deepEqual(loaded, ["browse", "installed", "settings"]);
  assert.equal(surfaces.get("browse")?.state.focused, true);
  assert.equal(surfaces.get("settings")?.state.focused, false);
  shell.dispose();
});

void test("shell forwards keys to the active surface and stops after finish", async () => {
  const { tui } = makeTui();
  const { surface, state } = makeSurface("browse");
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () => Promise.resolve(surface),
    () => undefined
  );
  await flush();

  shell.handleInput("x");
  assert.deepEqual(state.inputs, ["x"]);
  shell.finish();
  shell.handleInput("y");
  assert.deepEqual(state.inputs, ["x"]);
  assert.equal(state.disposed, 1);
});

void test("Esc cancels while a tab is still loading", async () => {
  const { tui } = makeTui();
  let cancels = 0;
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () => new Promise<PopupSurface>(() => undefined),
    () => {
      cancels += 1;
    }
  );
  shell.handleInput("\u001b");
  assert.equal(cancels, 1);
  assert.ok(shell.render(80).some((line) => line.includes("Loading browse")));
  shell.dispose();
});

void test("a failed tab load shows its error and r retries", async () => {
  const { tui } = makeTui();
  let attempts = 0;
  const { surface } = makeSurface("browse");
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("registry offline"));
      return Promise.resolve(surface);
    },
    () => undefined
  );
  await flush();

  assert.ok(shell.render(80).some((line) => line.includes("registry offline · r retry")));
  shell.handleInput("r");
  await flush();
  assert.equal(attempts, 2);
  assert.ok(shell.render(80).some((line) => line.includes("SURFACE:browse")));
  shell.dispose();
});

void test("dispose aborts pending loads and retires late surfaces", async () => {
  const { tui } = makeTui();
  const { surface, state } = makeSurface("browse");
  let release: (value: PopupSurface) => void = () => undefined;
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () =>
      new Promise<PopupSurface>((resolve) => {
        release = resolve;
      }),
    () => undefined
  );

  await flush();
  shell.dispose();
  release(surface);
  await flush();
  assert.equal(state.disposed, 1);
});

void test("very short terminals degrade to a single notice instead of overflowing", async () => {
  const { tui } = makeTui(8);
  const { surface } = makeSurface("browse");
  const shell = new PopupShell(
    tui,
    theme,
    keys,
    "browse",
    () => Promise.resolve(surface),
    () => undefined
  );
  await flush();

  const lines = shell.render(60);
  assert.equal(lines.length, 3);
  assert.ok(lines.length <= popupHeight(8));
  assert.ok(lines.some((line) => line.includes("Enlarge terminal")));
  shell.dispose();
});
