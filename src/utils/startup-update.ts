/**
 * Applies package updates automatically when pi starts, then asks for a reload.
 */
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getPackageCatalog } from "../packages/catalog.js";
import { clearSearchCache } from "../packages/discovery.js";
import { clearPackageEntrypointCache } from "../packages/extensions.js";
import { logPackageUpdate } from "./history.js";
import { logWarning } from "./log.js";
import { isProjectTrusted } from "./mode.js";
import { notify } from "./notify.js";
import { markReloadRequired } from "./reload-state.js";
import { calculateNextCheck, getAutoUpdateConfig, saveAutoUpdateConfig } from "./settings.js";

/** History label for updates applied without a user command. */
const STARTUP_UPDATE_LABEL = "startup update";

type SessionContext = ExtensionCommandContext | ExtensionContext;

export interface StartupUpdateOutcome {
  /** Packages whose installed version actually changed. */
  updated: string[];
  /** Outdated packages that failed to update. */
  failed: string[];
}

/** Startup updates stay on unless the user turned them off in settings. */
export function isStartupUpdateEnabled(ctx: SessionContext): boolean {
  return getAutoUpdateConfig(ctx).updateOnStart !== false;
}

/** Notifies without letting a not-yet-ready UI abort the update run. */
function notifyStartup(ctx: SessionContext, message: string, level: "info" | "error"): void {
  try {
    notify(ctx, message, level);
  } catch (error) {
    logWarning("Startup update notification failed:", error);
  }
}

/**
 * Updates every outdated package at startup and marks pi for a reload.
 * Never throws: a failed check or install only costs the notification.
 */
export async function applyStartupUpdates(
  pi: ExtensionAPI,
  ctx: SessionContext
): Promise<StartupUpdateOutcome> {
  const outcome: StartupUpdateOutcome = { updated: [], failed: [] };
  if (!ctx.hasUI || !isStartupUpdateEnabled(ctx)) return outcome;

  const catalog = getPackageCatalog(ctx.cwd, isProjectTrusted(ctx), { suppressOutput: true });

  let outdated: Awaited<ReturnType<typeof catalog.checkForAvailableUpdates>>;
  try {
    outdated = await catalog.checkForAvailableUpdates();
  } catch (error) {
    logWarning("Startup update check failed:", error);
    return outcome;
  }

  for (const pkg of outdated) {
    try {
      if (await catalog.update(pkg.source)) outcome.updated.push(pkg.displayName);
    } catch (error) {
      outcome.failed.push(pkg.displayName);
      const message = error instanceof Error ? error.message : String(error);
      logPackageUpdate(pi, pkg.source, pkg.displayName, undefined, false, message);
      logWarning(`Startup update failed for ${pkg.displayName}:`, error);
    }
  }

  if (outcome.updated.length === 0 && outcome.failed.length === 0) return outcome;

  const config = getAutoUpdateConfig(ctx);
  saveAutoUpdateConfig(pi, {
    ...config,
    lastCheck: Date.now(),
    nextCheck: calculateNextCheck(config.intervalMs),
    updatesAvailable: [],
  });

  if (outcome.updated.length > 0) {
    clearSearchCache();
    clearPackageEntrypointCache();
    logPackageUpdate(pi, STARTUP_UPDATE_LABEL, STARTUP_UPDATE_LABEL, undefined, true);
    const reason = `Updated at startup: ${outcome.updated.join(", ")}`;
    await markReloadRequired(reason).catch((error) => {
      logWarning("Failed to mark a reload as required:", error);
    });
    notifyStartup(ctx, `${reason}. Reload pi to load the new versions.`, "info");
  }

  if (outcome.failed.length > 0) {
    notifyStartup(ctx, `Startup update failed: ${outcome.failed.join(", ")}`, "error");
  }

  return outcome;
}
