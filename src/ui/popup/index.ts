import { type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runResolvedCommand } from "../../commands/registry.js";
import { PAGE_SIZE } from "../../constants.js";
import { discoverExtensions } from "../../extensions/discovery.js";
import { getRemotePackageBadges } from "../../packages/badges.js";
import {
  addWeeklyDownloadsToSearchPage,
  clearSearchCache,
  getInstalledPackages,
  getInstalledPackagesAllScopes,
  searchNpmPackages,
} from "../../packages/discovery.js";
import { discoverPackageExtensions } from "../../packages/extensions.js";
import {
  type BrowseAction,
  type NpmPackage,
  type State,
  type UnifiedAction,
  type UnifiedItem,
} from "../../types/index.js";
import { throwIfAborted } from "../../utils/abort.js";
import { getAutoUpdateStatus, getKnownUpdates } from "../../utils/auto-update.js";
import { parseNpmSource } from "../../utils/format.js";
import { hasCustomUI, isProjectTrusted } from "../../utils/mode.js";
import { findPackageRepository, openRepository } from "../../utils/open-repository.js";
import { reloadNow, wasContextReloaded } from "../../utils/ui-helpers.js";
import { getSavedViewsPath, readSavedViews, writeSavedViews } from "../../utils/views.js";
import { RemotePackageBrowser } from "../discover/browser.js";
import {
  createCommunityBrowsePlan,
  createRemoteBrowseQueryPlan,
  filterRemoteBrowseResults,
  type RemoteBrowseSource,
} from "../discover/query.js";
import { showHealth } from "../health.js";
import { showHelp } from "../help.js";
import { handleUnifiedAction, resolvePendingChangesBeforeLeave } from "../installed/actions.js";
import { UnifiedManagerBrowser } from "../installed/browser.js";
import { buildUnifiedItems } from "../installed/items.js";
import {
  managerStateToView,
  type UnifiedManagerViewState,
  viewToManagerState,
} from "../installed/state.js";
import { showProfiles } from "../profiles.js";
import { showMarketplacePackageActions } from "../remote.js";
import { popupWidth } from "./chrome.js";
import { PopupSettings, type SettingId } from "./settings.js";
import { PopupShell, type PopupSurface, type PopupTab } from "./shell.js";

type PopupAction =
  | { type: "cancel" }
  | { type: "browse"; action: BrowseAction }
  | { type: "installed"; action: UnifiedAction }
  | { type: "setting"; id: SettingId }
  | { type: "github"; pkg: NpmPackage | UnifiedItem };

type InstalledData = { items: UnifiedItem[]; byId: Map<string, UnifiedItem> };

/** UI components only select actions; mutations and reloads happen back in command context. */
export async function showExtensionsPopup(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI
): Promise<void> {
  if (!hasCustomUI(ctx)) {
    ctx.ui.notify(
      "Extensions popup requires the interactive TUI. Open /extensions in pi to manage packages.",
      "warning"
    );
    return;
  }
  let active: PopupTab = "browse";
  let query = "";
  let source: RemoteBrowseSource = "community";
  let offset = 0;
  let forceRefresh = false;
  let installed: InstalledData | undefined;
  let viewState: UnifiedManagerViewState | undefined;
  const staged = new Map<string, State>();
  const viewsPath = getSavedViewsPath(ctx.cwd);
  let savedViews = await readSavedViews(viewsPath);
  viewState = viewToManagerState(savedViews.lastView);

  const pendingGuard = async (): Promise<boolean> =>
    !installed ||
    (await resolvePendingChangesBeforeLeave(
      installed.items,
      staged,
      installed.byId,
      ctx,
      pi,
      "this action"
    )) === "continue";
  const saveView = async (): Promise<void> => {
    if (!viewState) return;
    const id = viewState.selectedItemId;
    savedViews = {
      ...savedViews,
      lastView: managerStateToView(viewState, "last-used", savedViews.lastView?.createdAt),
      recent: id
        ? [id, ...savedViews.recent.filter((entry) => entry !== id)].slice(0, 20)
        : savedViews.recent,
    };
    await writeSavedViews(viewsPath, savedViews);
  };

  while (true) {
    const result = await ctx.ui.custom<PopupAction>(
      (tui, theme, keys, done) => {
        let shell: PopupShell;
        let manager: UnifiedManagerBrowser | undefined;
        const complete = (action: PopupAction): void => {
          active = shell.tab;
          if (manager) viewState = manager.getViewState();
          shell.finish();
          done(action);
        };
        const settingAction = (id: SettingId | "cancel"): void => {
          if (id === "cancel") complete({ type: "cancel" });
          else if (id === "remote") shell.switchTab("browse");
          else if (id === "local" || id === "installed") shell.switchTab("installed");
          else complete({ type: "setting", id });
        };
        const load = async (tab: PopupTab, signal: AbortSignal): Promise<PopupSurface> => {
          throwIfAborted(signal);
          if (tab === "settings")
            return new PopupSettings(theme, keys, settingAction, getAutoUpdateStatus(ctx));
          if (tab === "installed") {
            if (!installed) installed = await loadInstalled(ctx, pi, signal);
            throwIfAborted(signal);
            manager = new UnifiedManagerBrowser(
              installed.items,
              staged,
              theme,
              keys,
              ctx.cwd,
              8,
              (action) => {
                if (action.type === "menu") {
                  shell.switchTab("settings");
                  return;
                }
                if (
                  action.type === "remote" ||
                  (action.type === "quick" && action.action === "search")
                ) {
                  shell.switchTab("browse");
                  return;
                }
                if (action.type === "quick") {
                  settingAction(action.action === "update-all" ? "update" : action.action);
                  return;
                }
                complete({ type: "installed", action });
              },
              new Set(savedViews.favorites),
              new Set(savedViews.recent),
              viewState,
              true
            );
            return managerSurface(manager, (pkg) => complete({ type: "github", pkg }));
          }
          const plan =
            source === "community"
              ? createCommunityBrowsePlan(query)
              : createRemoteBrowseQueryPlan(query);
          if (plan.kind === "unsupported") throw new Error(plan.message);
          const [page, allInstalled] = await Promise.all([
            searchNpmPackages(plan.searchQuery, ctx, {
              signal,
              offset,
              size: PAGE_SIZE,
              forceRefresh,
            }),
            getInstalledPackagesAllScopes(ctx),
          ]);
          throwIfAborted(signal);
          forceRefresh = false;
          const installedNames = npmNames(allInstalled.map((pkg) => pkg.source));
          const updateNames = npmNames([...getKnownUpdates(ctx)]);
          const packages = filterRemoteBrowseResults(plan, page.results).map((pkg) => ({
            ...pkg,
            ...getRemotePackageBadges(pkg, installedNames, updateNames),
          }));
          const total =
            plan.kind === "search" && plan.exactPackageName ? packages.length : page.total;
          const browser = new RemotePackageBrowser(
            packages,
            theme,
            keys,
            source,
            plan.displayQuery,
            total,
            offset,
            8,
            offset > 0,
            offset + page.results.length < total,
            (action) => {
              if (action.type === "menu") shell.switchTab("settings");
              else complete({ type: "browse", action });
            },
            true
          );
          // Hydration shares the overlay lifetime; no redraws after Escape/disposal.
          void addWeeklyDownloadsToSearchPage(page, signal)
            .then(() => {
              if (signal.aborted) return;
              const downloads = new Map(page.results.map((pkg) => [pkg.name, pkg.weeklyDownloads]));
              for (const pkg of packages) pkg.weeklyDownloads = downloads.get(pkg.name);
              browser.refreshSort();
              tui.requestRender();
            })
            .catch(() => undefined);
          return browseSurface(browser, (pkg) => complete({ type: "github", pkg }));
        };
        shell = new PopupShell(tui, theme, keys, active, load, () => complete({ type: "cancel" }));
        return shell;
      },
      {
        overlay: true,
        overlayOptions: () => ({ anchor: "center", width: popupWidth(), maxHeight: "90%" }),
      }
    );

    // Persist filter/selection before dispatch, but never reuse a retired context.
    await saveView();
    if (
      !result ||
      result.type === "cancel" ||
      ((result.type === "installed" || result.type === "browse") && result.action.type === "cancel")
    ) {
      if (!installed) return;
      const outcome = await handleUnifiedAction(
        { type: "cancel" },
        installed.items,
        staged,
        installed.byId,
        ctx,
        pi,
        savedViews,
        viewsPath,
        viewState
      );
      if (outcome !== "resume") return;
      active = "installed";
      continue;
    }
    try {
      if (result.type === "github") {
        const url = await findPackageRepository(result.pkg);
        if (!url) ctx.ui.notify("This package does not publish a GitHub repository.", "info");
        else if ((await openRepository(url)) === "copied")
          ctx.ui.notify("Could not open the browser; GitHub URL copied to clipboard.", "info");
        continue;
      }
      if (result.type === "browse") {
        const action = result.action;
        if (action.type === "search") {
          query = action.query;
          offset = 0;
        } else if (action.type === "prev") offset = Math.max(0, offset - PAGE_SIZE);
        else if (action.type === "next") offset += PAGE_SIZE;
        else if (action.type === "refresh") {
          const plan =
            source === "community"
              ? createCommunityBrowsePlan(query)
              : createRemoteBrowseQueryPlan(query);
          if (plan.kind !== "unsupported") clearSearchCache(plan.searchQuery);
          forceRefresh = true;
          offset = 0;
        } else if (action.type === "install" || action.type === "package") {
          if (!(await pendingGuard())) {
            if (wasContextReloaded(ctx)) return;
            active = "installed";
            continue;
          }
          if (action.type === "package") {
            if (await showMarketplacePackageActions(action.name, ctx, pi)) return;
          } else await runResolvedCommand({ id: "install", args: [] }, ctx, pi);
          if (wasContextReloaded(ctx)) return;
          installed = undefined;
        }
      } else if (result.type === "setting") {
        if (result.id === "search") {
          const entered = await ctx.ui.input(
            "Search npm",
            "Package name, keyword, or npm:@scope/pkg"
          );
          if (entered !== undefined) {
            query = entered.trim();
            source = query ? "npm" : "community";
            offset = 0;
            active = "browse";
          }
          continue;
        }
        if (!(await pendingGuard())) {
          if (wasContextReloaded(ctx)) return;
          active = "installed";
          continue;
        }
        if (await runSetting(result.id, ctx, pi)) return;
        if (wasContextReloaded(ctx)) return;
        installed = undefined;
      } else {
        if (!installed) continue;
        const outcome = await handleUnifiedAction(
          result.action,
          installed.items,
          staged,
          installed.byId,
          ctx,
          pi,
          savedViews,
          viewsPath,
          viewState
        );
        if (wasContextReloaded(ctx)) return;
        if (outcome === "resume") viewState = viewToManagerState(savedViews.lastView) ?? viewState;
        else installed = undefined;
      }
    } catch (error) {
      if (wasContextReloaded(ctx)) return;
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }
}

function npmNames(sources: string[]): Set<string> {
  return new Set(
    sources.flatMap((source) => {
      const parsed = parseNpmSource(source);
      return parsed ? [parsed.name] : [];
    })
  );
}

async function loadInstalled(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  signal: AbortSignal
): Promise<InstalledData> {
  const [local, packages] = await Promise.all([
    discoverExtensions(ctx.cwd, { projectTrusted: isProjectTrusted(ctx) }),
    getInstalledPackages(ctx, pi, undefined, signal),
  ]);
  throwIfAborted(signal);
  const extensions = await discoverPackageExtensions(packages, ctx.cwd, {
    projectTrusted: isProjectTrusted(ctx),
  });
  throwIfAborted(signal);
  const items = buildUnifiedItems(local, packages, getKnownUpdates(ctx), extensions);
  return { items, byId: new Map(items.map((item) => [item.id, item])) };
}

function browseSurface(
  browser: RemotePackageBrowser,
  github: (pkg: NpmPackage) => void
): PopupSurface {
  return {
    get focused() {
      return browser.focused;
    },
    set focused(value) {
      browser.focused = value;
    },
    get searching() {
      return browser.searching;
    },
    setViewportHeight: (height) => browser.setViewportHeight(height),
    render: (width) => browser.render(width),
    invalidate: () => browser.invalidate(),
    handleInput(data) {
      const pkg = browser.getSelectedPackage();
      if (data === "g" && !browser.searching && pkg) github(pkg);
      else browser.handleBrowseInput(data);
    },
  };
}
function managerSurface(
  browser: UnifiedManagerBrowser,
  github: (pkg: UnifiedItem) => void
): PopupSurface {
  return {
    get focused() {
      return browser.focused;
    },
    set focused(value) {
      browser.focused = value;
    },
    get searching() {
      return browser.searching;
    },
    setViewportHeight: (height) => browser.setViewportHeight(height),
    render: (width) => browser.render(width),
    invalidate: () => browser.invalidate(),
    handleInput(data) {
      const pkg = browser.getSelectedItem();
      if (data === "g" && !browser.searching && pkg) github(pkg);
      else browser.handleManagerInput(data);
    },
  };
}

async function runSetting(
  id: SettingId,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI
): Promise<boolean> {
  if (id === "reload") {
    if (typeof ctx.reload !== "function") {
      ctx.ui.notify("Run /reload to apply changes (shortcut contexts cannot reload).", "info");
      return false;
    }
    if (!(await ctx.ui.confirm("Reload pi", "Reload extensions now?"))) return false;
    return reloadNow(ctx);
  }
  if (id === "health") return (await showHealth(ctx, pi, true)) === "reloaded";
  if (id === "help") {
    await showHelp(ctx);
    return false;
  }
  if (id === "profile") {
    const choice = await ctx.ui.select("Profiles", [
      "Manage saved profiles",
      "Check profile source",
      "Recover restore point",
      "Back",
    ]);
    if (choice === "Manage saved profiles")
      return (await showProfiles(ctx, pi, true)) === "reloaded";
    if (choice === "Recover restore point")
      await runResolvedCommand({ id, args: ["recover"] }, ctx, pi);
    if (choice === "Check profile source") {
      const source = await ctx.ui.input("Profile source", "./profile.json or https://…");
      if (source?.trim()) await runResolvedCommand({ id, args: ["check", source.trim()] }, ctx, pi);
    }
    return wasContextReloaded(ctx);
  }
  if (id === "trash") {
    const choice = await ctx.ui.select("Extension trash", ["List", "Restore", "Purge", "Back"]);
    if (choice && choice !== "Back")
      await runResolvedCommand({ id, args: [choice.toLowerCase()] }, ctx, pi);
    return wasContextReloaded(ctx);
  }
  await runResolvedCommand({ id, args: [] }, ctx, pi);
  return wasContextReloaded(ctx);
}
