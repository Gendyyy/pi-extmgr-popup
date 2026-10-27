/** Verifies the Installed tab loader runs a live update check instead of reusing a stale snapshot. */
import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { loadInstalled } from "../src/ui/popup/index.js";
import { createMockHarness } from "./helpers/mocks.js";
import { mockPackageCatalog } from "./helpers/package-catalog.js";

initTheme();

void test("loadInstalled discovers an update with no scheduled check and an empty cache", async () => {
  const restoreCatalog = mockPackageCatalog({
    packages: [{ source: "npm:demo", name: "demo", scope: "global", version: "1.0.0" }],
    updates: [{ source: "npm:demo", displayName: "demo", type: "npm", scope: "global" }],
  });
  try {
    const { pi, ctx } = createMockHarness({ hasUI: true });

    const data = await loadInstalled(ctx, pi, new AbortController().signal);

    const item = data.items.find((entry) => entry.id === "pkg:npm:demo");
    assert.ok(
      item,
      `expected npm:demo to be listed, got ${data.items.map((e) => e.id).join(", ")}`
    );
    assert.equal(item.type, "package");
    assert.equal(item.type === "package" ? item.updateAvailable : undefined, true);
  } finally {
    restoreCatalog();
  }
});
