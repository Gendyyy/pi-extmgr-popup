import assert from "node:assert/strict";
import test from "node:test";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import extensionsManager from "../src/index.js";
import { popupWidth } from "../src/ui/popup/chrome.js";
import { captureCustomComponent } from "./helpers/custom-component.js";
import { createMockHarness } from "./helpers/mocks.js";
import { mockPackageCatalog } from "./helpers/package-catalog.js";

initTheme();

const theme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
  bold: (text: string) => text,
  style: (text: string) => text,
};

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface OverlayCall {
  options: { overlay?: boolean; overlayOptions?: () => Record<string, unknown> } | undefined;
  lines: string[];
}

function registerCommand() {
  let options:
    | {
        description: string;
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      }
    | undefined;
  return {
    install: (pi: ExtensionAPI): ExtensionAPI => {
      const target = pi as unknown as Record<string, unknown>;
      target.registerCommand = (name: string, value: typeof options) => {
        if (name === "extensions") options = value;
      };
      target.registerShortcut = () => undefined;
      target.on = () => undefined;
      return pi;
    },
    command: () => {
      assert.ok(options, "expected /extensions to be registered");
      return options;
    },
  };
}

function stubEmptySearch() {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify({ total: 0, objects: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

void test("/extensions opens the tabbed popup as a centered overlay", async () => {
  const restoreCatalog = mockPackageCatalog({ packages: [] });
  const search = stubEmptySearch();
  try {
    const { pi, ctx } = createMockHarness({ hasUI: true });
    const registration = registerCommand();
    extensionsManager(registration.install(pi));

    const calls: OverlayCall[] = [];
    (ctx.ui as { custom: unknown }).custom = (factory: unknown, options?: OverlayCall["options"]) =>
      captureCustomComponent(
        factory,
        theme,
        (component, lines, completion) => {
          calls.push({ options, lines });
          component.handleInput?.("\u001b");
          return completion;
        },
        { width: popupWidth() }
      );

    await registration.command().handler("", ctx);

    const popup = calls[0];
    assert.ok(popup, "popup overlay should open");
    assert.equal(popup.options?.overlay, true);
    const overlay = popup.options?.overlayOptions?.();
    assert.equal(overlay?.anchor, "center");
    assert.equal(overlay?.maxHeight, "90%");
    assert.equal(overlay?.width, popupWidth());
    assert.ok(popup.lines.length <= 36);
    assert.ok(popup.lines[0]?.includes("Extensions"));
    assert.ok(popup.lines[1]?.includes("[ Browse ]"));
    assert.ok(popup.lines[1]?.includes("Installed"));
    assert.ok(popup.lines[1]?.includes("Settings"));
    for (const line of popup.lines) assert.ok(visibleWidth(line) <= popupWidth(), line);
  } finally {
    search.restore();
    restoreCatalog();
  }
});

void test("the Settings tab runs former slash commands instead of exiting", async () => {
  const restoreCatalog = mockPackageCatalog({ packages: [] });
  const search = stubEmptySearch();
  try {
    const { pi, ctx } = createMockHarness({ hasUI: true });
    const registration = registerCommand();
    extensionsManager(registration.install(pi));

    const calls: OverlayCall[] = [];
    (ctx.ui as { custom: unknown }).custom = (factory: unknown, options?: OverlayCall["options"]) =>
      captureCustomComponent(factory, theme, async (component, lines, completion) => {
        calls.push({ options, lines });
        // The first overlay is the popup; later overlays are report panels.
        if (!lines.some((line) => line.includes("[ Browse ]"))) {
          component.handleInput?.("\u001b");
          return completion;
        }
        await flush();
        component.handleInput?.("\t");
        await flush();
        component.handleInput?.("\t");
        await flush();
        const settingsLines = component.render(100);
        calls.push({ options, lines: settingsLines });
        assert.ok(settingsLines.some((line) => line.includes("[ Settings ]")));
        assert.ok(settingsLines.some((line) => line.includes("Scheduled update checks")));
        // Up from the first row wraps to the last entry: keyboard shortcuts.
        component.handleInput?.("\u001b[A");
        component.handleInput?.("\r");
        await flush();
        return completion;
      });

    await registration.command().handler("", ctx);

    assert.ok(
      calls.some((call) => call.lines.some((line) => line.includes("Extensions Manager Help"))),
      "selecting Settings → help should open the help report"
    );
    assert.ok(
      calls.some((call) => call.lines.some((line) => line.includes("Popup navigation"))),
      "the rewritten help describes the popup model"
    );
  } finally {
    search.restore();
    restoreCatalog();
  }
});

void test("closing the popup never mutates packages", async () => {
  const restoreCatalog = mockPackageCatalog({ packages: [] });
  const search = stubEmptySearch();
  try {
    const { pi, ctx, calls: execCalls, reloadCount } = createMockHarness({ hasUI: true });
    const registration = registerCommand();
    extensionsManager(registration.install(pi));

    let cancels = 0;
    (ctx.ui as { custom: unknown }).custom = (
      factory: unknown,
      _options?: OverlayCall["options"]
    ) =>
      captureCustomComponent(factory, theme, async (component, lines, completion) => {
        cancels += 1;
        await flush();
        component.handleInput?.("\t");
        await flush();
        component.handleInput?.("\t");
        await flush();
        assert.ok(lines.length > 0, "popup rendered at least one row");
        component.handleInput?.("\u001b");
        return completion;
      });

    await registration.command().handler("", ctx);
    assert.equal(cancels, 1);
    assert.deepEqual(execCalls, [], "browsing the popup must not run pi install/remove/list");
    assert.equal(reloadCount(), 0);
  } finally {
    search.restore();
    restoreCatalog();
  }
});
