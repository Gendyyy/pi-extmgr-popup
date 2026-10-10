import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type UnifiedItem } from "../src/types/index.js";
import {
  findPackageRepository,
  githubRepositoryUrl,
  openRepository,
  type RepositoryOpener,
} from "../src/utils/open-repository.js";

void test("githubRepositoryUrl normalizes the forms npm and git publish", () => {
  assert.equal(
    githubRepositoryUrl("https://github.com/owner/repo"),
    "https://github.com/owner/repo"
  );
  assert.equal(
    githubRepositoryUrl("https://github.com/owner/repo.git"),
    "https://github.com/owner/repo"
  );
  assert.equal(
    githubRepositoryUrl("git+https://github.com/owner/repo.git"),
    "https://github.com/owner/repo"
  );
  assert.equal(
    githubRepositoryUrl("git@github.com:owner/repo.git"),
    "https://github.com/owner/repo"
  );
  assert.equal(
    githubRepositoryUrl("ssh://git@github.com/owner/repo.git"),
    "https://github.com/owner/repo"
  );
  assert.equal(githubRepositoryUrl("github.com/owner/repo"), "https://github.com/owner/repo");
  assert.equal(
    githubRepositoryUrl({ url: "https://github.com/owner/repo#readme" }),
    "https://github.com/owner/repo"
  );
  assert.equal(
    githubRepositoryUrl("https://github.com/owner/repo/tree/main/packages/x"),
    "https://github.com/owner/repo"
  );
});

void test("githubRepositoryUrl rejects anything that is not a plain GitHub repo", () => {
  for (const value of [
    undefined,
    null,
    42,
    "",
    "not a url",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://user:token@github.com/owner/repo",
    "https://github.com:8080/owner/repo",
    "https://github.com/owner",
    "https://github.com/",
    "https://github.com/../repo",
    "https://github.com/owner/../repo",
    "ftp://github.com/owner/repo",
    "https://github.com/owner/repo\n",
  ]) {
    assert.equal(githubRepositoryUrl(value), undefined, String(value));
  }
});

function recorder(result: "ok" | "fail" = "ok") {
  const calls: string[] = [];
  const opener: RepositoryOpener = {
    run: async (command, args) => {
      calls.push([command, ...args].join(" "));
      if (result === "fail") throw new Error("spawn failed");
    },
    copy: (text) => {
      calls.push(`copy:${text}`);
    },
  };
  return { opener, calls };
}

void test("openRepository uses the platform opener", async () => {
  const url = "https://github.com/owner/repo";
  const darwin = recorder();
  assert.equal(await openRepository(url, "darwin", darwin.opener), "opened");
  assert.deepEqual(darwin.calls, [`open ${url}`]);

  const win = recorder();
  assert.equal(await openRepository(url, "win32", win.opener), "opened");
  assert.deepEqual(win.calls, [`rundll32.exe url.dll,FileProtocolHandler ${url}`]);

  const linux = recorder();
  assert.equal(await openRepository(url, "linux", linux.opener), "opened");
  assert.deepEqual(linux.calls, [`xdg-open ${url}`]);
});

void test("openRepository copies the URL when the opener fails", async () => {
  const url = "https://github.com/owner/repo";
  const { opener, calls } = recorder("fail");
  assert.equal(await openRepository(url, "darwin", opener), "copied");
  assert.deepEqual(calls, [`open ${url}`, `copy:${url}`]);
});

void test("openRepository refuses to open a non-GitHub URL", async () => {
  const { opener, calls } = recorder();
  await assert.rejects(() => openRepository("https://evil.test/x", "darwin", opener));
  assert.deepEqual(calls, []);
});

void test("findPackageRepository prefers npm metadata and skips the network", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => {
    fetches += 1;
    return Promise.reject(new Error("network must not be used"));
  }) as typeof fetch;
  try {
    const url = await findPackageRepository({
      name: "direct",
      repository: "git+https://github.com/owner/direct.git",
    });
    assert.equal(url, "https://github.com/owner/direct");
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("findPackageRepository falls back to the npm registry and caches the result", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    fetches += 1;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "https://registry.npmjs.org/lookup-cached/latest");
    return Promise.resolve(
      new Response(JSON.stringify({ repository: "https://github.com/owner/lookup-cached.git" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  }) as typeof fetch;
  try {
    assert.equal(
      await findPackageRepository({ name: "lookup-cached" }),
      "https://github.com/owner/lookup-cached"
    );
    assert.equal(
      await findPackageRepository({ name: "lookup-cached" }),
      "https://github.com/owner/lookup-cached"
    );
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("findPackageRepository reads github sources and local manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-extmgr-repo-"));
  try {
    const localPackage: UnifiedItem = {
      type: "local",
      id: "local",
      displayName: "local",
      summary: "",
      scope: "global",
      state: "enabled",
      activePath: join(root, "x.ts"),
      disabledPath: join(root, "x.ts.disabled"),
      originalState: "enabled",
    };
    assert.equal(await findPackageRepository(localPackage), undefined);

    const gitPackage: UnifiedItem = {
      type: "package",
      id: "git",
      displayName: "git-package",
      scope: "global",
      source: "git+https://github.com/owner/git-package.git",
    };
    assert.equal(await findPackageRepository(gitPackage), "https://github.com/owner/git-package");

    const manifestDir = join(root, "manifest-package");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "package.json"),
      JSON.stringify({ repository: { url: "git@github.com:owner/manifest-package.git" } }),
      "utf8"
    );
    const fromManifest: UnifiedItem = {
      type: "package",
      id: "manifest",
      displayName: "manifest-package",
      scope: "global",
      source: "npm:manifest-package",
      resolvedPath: manifestDir,
    };
    assert.equal(
      await findPackageRepository(fromManifest),
      "https://github.com/owner/manifest-package"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
