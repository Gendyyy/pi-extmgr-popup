import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { TIMEOUTS } from "../constants.js";
import { type NpmPackage, type UnifiedItem } from "../types/index.js";
import { parseNpmSource } from "./format.js";
import { fetchWithTimeout } from "./network.js";

/** Only open canonical HTTPS GitHub repository URLs, never arbitrary registry URLs. */
export function githubRepositoryUrl(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "url" in value
        ? value.url
        : undefined;
  if (
    typeof raw !== "string" ||
    Array.from(raw).some(
      (char) => char.charCodeAt(0) <= 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    )
  )
    return undefined;
  let normalized = raw.replace(/^git\+/, "").replace(/^git:/, "");
  normalized = normalized
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  if (normalized.startsWith("//github.com/")) normalized = `https:${normalized}`;
  if (normalized.startsWith("github.com/")) normalized = `https://${normalized}`;
  // git:// repository metadata is common; it still opens via HTTPS.
  normalized = normalized.replace(/^\/\/github\.com\//, "https://github.com/");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return undefined;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port
  )
    return undefined;
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.split("@")[0]?.replace(/\.git$/, "");
  if (
    !owner ||
    !repo ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repo) ||
    [owner, repo].some((part) => part === "." || part === "..")
  )
    return undefined;
  return `https://github.com/${owner}/${repo}`;
}

const repositories = new Map<string, string | undefined>();
async function npmRepository(name: string, signal?: AbortSignal): Promise<string | undefined> {
  if (repositories.has(name)) return repositories.get(name);
  const response = await fetchWithTimeout(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
    TIMEOUTS.npmView,
    signal
  );
  if (!response.ok) throw new Error(`Repository lookup failed: HTTP ${response.status}`);
  const manifest = (await response.json()) as { repository?: unknown };
  const url = githubRepositoryUrl(manifest.repository);
  if (repositories.size >= 200) repositories.clear();
  repositories.set(name, url);
  return url;
}

export async function findPackageRepository(
  pkg: NpmPackage | UnifiedItem,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (!("type" in pkg))
    return githubRepositoryUrl(pkg.repository) ?? npmRepository(pkg.name, signal);
  if (pkg.type === "local") return undefined;
  const sourceUrl = githubRepositoryUrl(pkg.source);
  if (sourceUrl) return sourceUrl;
  if (pkg.resolvedPath) {
    try {
      const path = pkg.resolvedPath.endsWith("package.json")
        ? pkg.resolvedPath
        : join(pkg.resolvedPath, "package.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as { repository?: unknown };
      const url = githubRepositoryUrl(manifest.repository);
      if (url) return url;
    } catch {
      /* A missing manifest can still be looked up on npm. */
    }
  }
  const parsed = parseNpmSource(pkg.source);
  return parsed ? npmRepository(parsed.name, signal) : undefined;
}

export interface RepositoryOpener {
  run(command: string, args: string[]): Promise<void>;
  copy(text: string): void | Promise<void>;
}
const defaultOpener: RepositoryOpener = {
  run: (command, args) =>
    new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 10_000, windowsHide: true }, (error) =>
        error ? reject(error) : resolve()
      );
    }),
  copy: copyToClipboard,
};

export async function openRepository(
  url: string,
  platform: NodeJS.Platform = process.platform,
  opener = defaultOpener
): Promise<"opened" | "copied"> {
  const safe = githubRepositoryUrl(url);
  if (!safe) throw new Error("No valid GitHub repository URL.");
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", safe] : [safe];
  try {
    await opener.run(command, args);
    return "opened";
  } catch {
    await opener.copy(safe);
    return "copied";
  }
}
