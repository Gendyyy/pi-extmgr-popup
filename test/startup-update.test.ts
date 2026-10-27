/**
 * Tests for automatic package updates applied at pi startup.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extensionsManager from "../src/index.js";
import { promptAutoUpdateWizard } from "../src/utils/auto-update.js";
import { readReloadState } from "../src/utils/reload-state.js";
import { getAutoUpdateConfig } from "../src/utils/settings.js";
import { applyStartupUpdates, isStartupUpdateEnabled } from "../src/utils/startup-update.js";
import { createMockHarness } from "./helpers/mocks.js";
import { mockPackageCatalog } from "./helpers/package-catalog.js";

/** Runs a test with a throwaway cache dir so reload markers never leak between tests. */
async function withIsolatedState<T>(run: () => Promise<T>): Promise<T> {
  const cacheDir = await mkdtemp(join(tmpdir(), "pi-extmgr-startup-update-"));
  const previousCache = process.env.PI_EXTMGR_CACHE_DIR;
  process.env.PI_EXTMGR_CACHE_DIR = cacheDir;
  try {
    return await run();
  } finally {
    if (previousCache === undefined) delete process.env.PI_EXTMGR_CACHE_DIR;
    else process.env.PI_EXTMGR_CACHE_DIR = previousCache;
    await rm(cacheDir, { recursive: true, force: true });
  }
}

const OUTDATED = [
  {
    source: "npm:demo-pkg@1.0.0",
    displayName: "demo-pkg",
    type: "npm" as const,
    scope: "global" as const,
  },
  {
    source: "npm:other-pkg@2.0.0",
    displayName: "other-pkg",
    type: "npm" as const,
    scope: "project" as const,
  },
];

void test("startup updates apply every outdated package and leave a reload marker", async () => {
  await withIsolatedState(async () => {
    const updatedSources: (string | undefined)[] = [];
    const restoreCatalog = mockPackageCatalog({
      updates: OUTDATED,
      updateImpl: (source) => {
        updatedSources.push(source);
        return true;
      },
    });

    try {
      const { pi, ctx, notifications } = createMockHarness({ hasUI: true });

      const outcome = await applyStartupUpdates(pi, ctx);

      assert.deepEqual(updatedSources, ["npm:demo-pkg@1.0.0", "npm:other-pkg@2.0.0"]);
      assert.deepEqual(outcome, { updated: ["demo-pkg", "other-pkg"], failed: [] });
      assert.ok(
        notifications.some((entry) => /Updated at startup: demo-pkg, other-pkg/.test(entry.message))
      );

      const state = await readReloadState();
      assert.ok(state);
      assert.match(JSON.stringify(state), /Updated at startup: demo-pkg, other-pkg/);

      const config = getAutoUpdateConfig(ctx);
      assert.deepEqual(config.updatesAvailable ?? [], []);
      assert.equal(typeof config.lastCheck, "number");
    } finally {
      restoreCatalog();
    }
  });
});

void test("startup updates do nothing when the user turned them off", async () => {
  await withIsolatedState(async () => {
    let updateCalls = 0;
    const restoreCatalog = mockPackageCatalog({
      updates: OUTDATED,
      updateImpl: () => {
        updateCalls += 1;
        return true;
      },
    });

    try {
      const { pi, ctx, entries } = createMockHarness({ hasUI: true });
      entries.push({
        type: "custom",
        customType: "extmgr-auto-update",
        data: {
          enabled: false,
          intervalMs: 0,
          displayText: "off",
          updatesAvailable: [],
          updateOnStart: false,
        },
      });

      assert.equal(isStartupUpdateEnabled(ctx), false);
      const outcome = await applyStartupUpdates(pi, ctx);

      assert.equal(updateCalls, 0);
      assert.deepEqual(outcome, { updated: [], failed: [] });
      assert.equal((await readReloadState()).required, false);
    } finally {
      restoreCatalog();
    }
  });
});

void test("startup updates skip the install step when nothing is outdated", async () => {
  await withIsolatedState(async () => {
    let updateCalls = 0;
    const restoreCatalog = mockPackageCatalog({
      updates: [],
      updateImpl: () => {
        updateCalls += 1;
        return true;
      },
    });

    try {
      const { pi, ctx } = createMockHarness({ hasUI: true });

      const outcome = await applyStartupUpdates(pi, ctx);

      assert.equal(updateCalls, 0);
      assert.deepEqual(outcome, { updated: [], failed: [] });
      assert.equal((await readReloadState()).required, false);
    } finally {
      restoreCatalog();
    }
  });
});

void test("a failing package does not stop the remaining startup updates", async () => {
  await withIsolatedState(async () => {
    const restoreCatalog = mockPackageCatalog({
      updates: OUTDATED,
      updateImpl: (source) => {
        if (source === "npm:demo-pkg@1.0.0") throw new Error("registry unreachable");
        return true;
      },
    });

    try {
      const { pi, ctx, notifications } = createMockHarness({ hasUI: true });

      const outcome = await applyStartupUpdates(pi, ctx);

      assert.deepEqual(outcome, { updated: ["other-pkg"], failed: ["demo-pkg"] });
      assert.ok(
        notifications.some(
          (entry) =>
            entry.level === "error" && /Startup update failed: demo-pkg/.test(entry.message)
        )
      );
      assert.match(JSON.stringify(await readReloadState()), /other-pkg/);
    } finally {
      restoreCatalog();
    }
  });
});

void test("running pi applies startup updates once, even with scheduled checks off", async () => {
  await withIsolatedState(async () => {
    const handlers: Record<string, ((event: unknown, ctx: unknown) => Promise<void>) | undefined> =
      {};
    const pi = {
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) => {
        handlers[event] = handler;
      },
      appendEntry: () => undefined,
    };
    const updatedSources: (string | undefined)[] = [];
    const restoreCatalog = mockPackageCatalog({
      updates: OUTDATED,
      updateImpl: (source) => {
        updatedSources.push(source);
        return true;
      },
    });

    try {
      const { ctx, notifications } = createMockHarness({ hasUI: true });
      extensionsManager(pi as unknown as ExtensionAPI);

      await handlers.session_start?.({}, ctx);
      assert.deepEqual(updatedSources, ["npm:demo-pkg@1.0.0", "npm:other-pkg@2.0.0"]);
      assert.ok(notifications.some((entry) => /Updated at startup/.test(entry.message)));
      assert.equal((await readReloadState()).required, true);

      // /new, /resume and forks reopen the session without restarting pi.
      await handlers.session_start?.({ reason: "resume" }, ctx);
      assert.equal(updatedSources.length, 2);
    } finally {
      restoreCatalog();
    }
  });
});

void test("the settings wizard toggles startup updates off", async () => {
  const { pi, ctx } = createMockHarness({ hasUI: true, selectResult: "Startup updates: on" });

  assert.equal(isStartupUpdateEnabled(ctx), true);
  await promptAutoUpdateWizard(pi, ctx);
  assert.equal(isStartupUpdateEnabled(ctx), false);
});
