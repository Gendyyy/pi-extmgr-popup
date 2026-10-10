# pi-extmgr

![pi-extmgr banner](https://i.imgur.com/Ce513Br.png)

[![CI](https://github.com/ayagmar/pi-extmgr/actions/workflows/ci.yml/badge.svg)](https://github.com/ayagmar/pi-extmgr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better way to manage Pi extensions. Browse, install, enable/disable, and remove extensions from one floating popup.
Built on top of Pi's native package install, update, and config flows, so extmgr stays aligned with current upstream behavior.

This fork (`pi-extmgr-popup`) replaces the original full-screen manager and its `/extensions <subcommand>`
command surface with a single centered popup: **Browse · Installed · Settings**. `/extensions` and
`Ctrl+Alt+E` open the popup and nothing else.

**🌐 [pi-extmgr landing page](https://ayagmar.github.io/pi-extmgr)**

## Install

```bash
pi install npm:pi-extmgr
```

Or install straight from GitHub:

```bash
pi install git:github.com/ayagmar/pi-extmgr
```

This fork is installed from its own repo or straight from the working copy:

```bash
pi install git:github.com/Gendyyy/pi-extmgr-popup
pi install /Users/ahmedgendy/Projects/pi-extmgr-popup   # local working copy
```

Do not install the fork and upstream `pi-extmgr` at the same time — both register `/extensions`.
Remove one first with `pi remove npm:pi-extmgr`.

If Pi is already running, use `/reload`.

Requires Pi `>=1.0.1` and Node.js `>=22.19.0`. Use pi-extmgr `0.3.x` with older Pi releases.

Update it with `pi update npm:pi-extmgr` or `pi update --extensions` (a bare `pi update` only updates Pi itself).
Project-scoped installs (`pi install npm:pi-extmgr -l`) need the project to be trusted.

### Where packages live

Pi installs global npm packages into its own managed root, `~/.pi/agent/npm` (or `$PI_CODING_AGENT_DIR/npm`),
and project packages into `.pi/npm`. No global npm prefix is involved, so an unwritable `npm_config_prefix`
no longer matters. extmgr reads the same locations. If npm needs a specific Node version or you want a
different package manager, set Pi's `npmCommand` setting.

`npmCommand` examples for `~/.pi/agent/settings.json`:

```jsonc
{
  // mise: run npm through Node 22
  // "npmCommand": ["mise", "exec", "node@22", "--", "npm"]

  // bun: use Bun as Pi's package-manager command
  // "npmCommand": ["bun"]

  // nvm: start Pi from an nvm-enabled shell and use npm on PATH
  // "npmCommand": ["npm"]
}
```

## Features

- **Tabbed popup UI**
  - Opens as a centered floating window (up to 110 columns, 90% of the terminal height) over the session, so the transcript stays visible
  - Three tabs — Browse · Installed · Settings — cycled with `Tab` / `Shift+Tab`; each tab loads lazily and keeps its own search state
  - Local extensions (`~/.pi/agent/extensions`, plus `.pi/extensions` in trusted projects) and installed packages in one list
  - Grouped sections for local extensions vs installed packages
  - Every list row shows its description on a sub-line, and `g` opens the selected package's GitHub repository
  - Focused primary filters and contextual one-line controls; secondary actions remain available through the command palette and help
  - Built-in search and filter shortcuts for large extension sets
  - Scope indicators (global/project), status indicators, update badges, and package sizes when known
- **Package extension configuration panel**
  - Configure individual extension entrypoints inside an installed package (`c` on package row)
  - Works with manifest-declared entrypoints and conventional `extensions/` package layouts
  - Persists to package filters in `settings.json` (no manual JSON editing)
- **Safe staged local extension toggles**
  - Toggle with `Space`, apply with `S`
  - Unsaved-change guard when leaving (save/discard/stay)
- **Package management**
  - Install, update, remove from UI and command line
  - Quick actions (`A`, `u`, `X`) and coordinated bulk package actions (`B`)
- **Remote discovery and install**
  - npm search/browse with server-side pagination, inline browse search, keyboard page navigation, and rate-limit-aware retries
  - Weekly npm downloads in browse rows/details plus popularity sorting (`o` cycles sort modes)
  - Path- and git-like queries are handled explicitly instead of surfacing unrelated npm results
  - Install by source (`npm:`, `git:`, `https://`, `ssh://`, `git@...`, local path)
  - Supports direct GitHub `.ts` installs and standalone local install for self-contained packages
  - Search results render immediately; weekly download metrics hydrate in the background and update the visible rows
  - Long-running discovery/detail screens now show dedicated loading UI, and cancellable reads can be aborted with `Esc`
- **Scheduled update checks**
  - Interactive wizard (`t` in the Installed tab, or Settings → Scheduled update checks)
  - Persistent schedule restored on startup and session switch
  - Background checks + status bar updates for installed npm + git packages
- **Tabs**
  - Browse: community npm search, package inspection, downloads, and popularity sorting
  - Installed: local extensions, packages, updates, and staged changes
  - Settings: every former `/extensions <subcommand>` action, grouped and searchable — auto-update wizard, profiles, health, doctor, history, trash, clear-cache, install, remove, update, reload, help
- **Profiles and health screens**
  - Profiles: inline current-vs-target diffs (scope, version, ref, filters, checksum); applying always passes through the review screen
  - Health: runtime conflicts, compatibility, reload state, recoverable trash, conflict remediation, and a conservative “fix all safe issues” action (never removes packages)
- **Operational visibility**
  - Session history (Settings → History)
  - Cache controls (Settings → Clear cache clears persistent + runtime extmgr caches)
  - Status line summary (`pkg count • scheduled update checks • known updates`)
  - History now records local extension deletions and scheduled update checks configuration changes
- **Overlay-first output**
  - Help, item details, bulk summaries, doctor, history, trash lists, and profile check/import reports open in a floating scrollable panel instead of the chat transcript
  - Reference peeks (help, details) float beside the list; standalone reports (doctor, history, summaries) center on screen
  - Package updates show progress in a corner overlay while the session stays visible
  - A one-line attention widget above the editor appears when updates are known or a reload is pending, and clears once handled
  - The popup is read-only chrome: nothing is written to disk until you confirm an action
- **Interactive UI only**
  - The popup requires the full interactive TUI; without one, `/extensions` explains how to open it
  - Report content (help, doctor, history, summaries) still degrades to plain notifications in non-UI modes
  - Scheduled update checks keep running in the background and continue to discover updates; package updates remain explicit

## Usage

Open the popup:

```
/extensions
```

Or press `Ctrl+Alt+E` from anywhere in the pi TUI. The popup opens as a centered floating window
over the session, so the transcript stays visible and closing it never tears down the session.

### Tabs

| Tab           | What it holds                                                                            |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Browse**    | Community npm search, package details, install, weekly downloads, popularity sorting      |
| **Installed** | Local extensions + installed packages, staged toggles, updates, package config, remove    |
| **Settings**  | Every former slash subcommand, grouped and searchable with `/`                            |

`Tab` / `Shift+Tab` cycles tabs. Each tab loads lazily the first time it is shown and keeps its
own search and scroll state while the popup stays open.

### Keys

| Key           | Action                                                |
| ------------- | ----------------------------------------------------- |
| `Tab` / `Shift+Tab` | Cycle Browse · Installed · Settings               |
| `g`           | Open the selected package's GitHub repository          |
| `r`           | Retry the tab that failed to load                     |
| `↑↓`          | Navigate                                              |
| `PageUp/Down` | Jump through longer lists                             |
| `Home/End`    | Jump to top or bottom                                 |
| `Space`       | Toggle selected local extension on/off                |
| `S`           | Save local extension changes                          |
| `Enter` / `A` | Actions on selected item                              |
| `/` / `Ctrl+F`| Search visible items                                  |
| `1-7`         | Filter: All / Local / Packages / Updates / Disabled / Favorites / Recent |
| `c`           | Configure selected package extensions                 |
| `u`           | Update selected package directly                      |
| `V`           | View full details for selected item                   |
| `X`           | Remove selected item (package/local extension)        |
| `i`           | Quick install by source                               |
| `f`           | Remote package search                                 |
| `B`           | Bulk actions for selected packages                    |
| `W` / `L` / `D` | Save / load / delete manager views                  |
| `*`           | Toggle favorite for selected item                     |
| `U`           | Update all packages                                   |
| `t`           | Scheduled update checks wizard                                    |
| `P` / `M`     | Workspace screens and actions                         |
| `R`           | Browse remote packages                                |
| `?` / `H`     | Help                                                  |
| `Esc` / `Ctrl+C` | Back out of search, then the tab, then close the popup |

In Pi's default fullscreen TUI, `PageUp`/`PageDown`/`Home`/`End` scroll the transcript before the manager
sees them. Use `↑↓`, start Pi with `--tui-mode regular`, or rebind `tui.altScreen.pageUp`,
`tui.altScreen.pageDown`, `tui.altScreen.top` and `tui.altScreen.bottom` in `keybindings.json`.
Report panels (help, details, doctor, history) are overlays and keep these keys.

### Settings tab

The Settings tab replaces the old `/extensions <subcommand>` surface. Filter with `/`, then press
`Enter` to run the highlighted row. Every row calls the same code path the subcommand used, so
behaviour is unchanged — only the entry point moved.

| Row | What it does |
| --- | ------------ |
| Scheduled update checks | Auto-update wizard and persistent schedule (`never`, `daily`, `weekly`, `monthly`, `1d`, `1w`, `1mo`, …) |
| Profiles | Manage saved profiles, check a profile source, recover a restore point (save/export/apply/rename/duplicate/delete happen inside the Profiles screen) |
| Health | Runtime, compatibility, reload and trash diagnostics |
| Doctor | Ownership and package compatibility report |
| History | Session change history |
| Trash | List, restore or purge local extension trash |
| Clear cache | Clear persistent + runtime extmgr caches |
| Install a package | Install by source (see below) |
| Remove a package | Pick an installed package and remove it |
| Update packages | Preview or apply package updates |
| List extensions | Read-only list of local extensions |
| Installed packages | Read-only list of installed packages |
| Browse remote packages | Switch to the Browse tab |
| Search npm | Switch to the Browse tab with a query |
| Reload pi | Confirm and reload extensions immediately |
| Help | Full reference report |

### Install sources

Sources are typed in the Settings tab's install row, or selected from a Browse result:

```
npm:package-name
@scope/package
git:https://github.com/user/repo.git
git:git@github.com:user/repo.git
ssh://git@github.com/user/repo.git
https://github.com/user/repo/blob/main/extension.ts
/path/to/extension.ts
./local-folder/
```

### Non-interactive mode

The popup needs a terminal UI. When Pi runs without one, `/extensions` prints:

> Extensions popup requires the interactive TUI. Open /extensions in pi to manage packages.

The scriptable subcommand surface is intentionally gone. For automation use pi's own commands
(`pi install`, `pi remove`, `pi update --extensions`). History filtering options (`--action`,
`--since`, `--package`, `--global`, `--limit`, `--success`/`--failed`) are likewise no longer
reachable as command arguments; the History row shows the default view.

### RPC / limited-UI mode

Panels and the popup require the full interactive TUI. Package extension configuration, remote
browsing and search all live in the popup; reports (help, doctor, history) fall back to plain
notifications.

## Tips

- **Staged local changes**: Toggle local extensions on/off, then press `S` to apply all at once.
- **Package extension config**: Select a package and press `c` (or Enter/A → Configure) to enable/disable individual package entrypoints.
  - After saving package extension config, run /reload to apply changes.
- **Two install modes**:
  - **Managed** (npm/git): installed by Pi's package manager into `~/.pi/agent/npm` / `~/.pi/agent/git` (project scope: `.pi/npm` / `.pi/git`), updated from extmgr or with `pi update --extensions`, supports Pi package manifest/convention loading
  - **Local** (standalone): Copies to `~/.pi/agent/extensions/{package}/`, so it only accepts runnable standalone layouts (manifest-declared/root entrypoints), requires `tar` on `PATH`, and rejects packages whose runtime `dependencies` are not already bundled with the package contents
- **Scheduled update-check schedule is persistent**: the Settings tab's Scheduled update checks row (e.g. `1d`) stays active across future Pi sessions and is restored when switching sessions.
- **Scheduled update-check badges cover npm + git packages**: extmgr now uses pi's package manager APIs for structured update detection instead of parsing `pi list` output.
- **Settings/cache writes are hardened**: extmgr serializes writes and uses safe file replacement to reduce JSON corruption issues.
- **Invalid JSON is handled safely**: malformed `auto-update.json` / metadata cache files are backed up and reset; invalid `.pi/settings.json` is not overwritten during package-extension toggles.
- **Reload is built-in**: When extmgr asks to reload, it calls `ctx.reload()` directly. Successful mutations persist a versioned reload-required marker; cancellation and failure do not. The marker survives reopening the manager and clears after a successful reload.
- **Saved manager state**: Views, favorites, recent items, and bulk selections are stored atomically in `~/.pi/agent/.extmgr-cache/views-<project>.json`. Named profiles are stored in `profiles.json`; project policies load from `.pi/extmgr-policy.json`.
- **Trash lifecycle**: Local removals move to `~/.pi/agent/.extmgr-trash/` with persistent records. Undo refuses to overwrite a replacement file, and expired or missing records are cleaned up.
- **Metadata safety**: Missing compatibility, provenance, checksum, or target-version metadata is reported as `unknown`, never `safe`. Target-version previews, exact target badges, and update-policy/maintenance-window enforcement are intentionally deferred because Pi does not expose structured target metadata.

## Releasing

Releases are cut from GitHub Actions — never from a laptop.

1. Merge Conventional Commits (`feat:`, `fix:`, `feat!:` …) into `master`.
2. Run **Actions → Release → Run workflow** (or `gh workflow run release.yml -f increment=auto`).
   `auto` derives the bump from the commits; pick `patch`/`minor`/`major` to override. Tick `dry_run` to preview.
3. The workflow runs `pnpm run check`, then release-it bumps `package.json`, updates `CHANGELOG.md`,
   tags `vX.Y.Z`, pushes and creates the GitHub release, and finally `npm publish` publishes with
   provenance through npm trusted publishing (OIDC — no npm token stored in the repo).

Preview locally with `pnpm release:dry`.

Before the first release from this workflow, configure trusted publishing on npmjs.com for
`pi-extmgr` (GitHub Actions · `ayagmar/pi-extmgr` · workflow `release.yml`); the package already
exists on npm, so no `bootstrap` run is needed. If a run already tagged and created the GitHub
release but failed at `npm publish`, re-run it with `publish_only: true` instead of cutting a new
version.

## License

MIT
