/// <reference types="vitest/globals" />
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveIndexFlatIP } from "../src/knowledge/faiss";
import { resolveProjectRoot, resolveVaultRoot, toPosixPath } from "../src/knowledge/paths";

describe("resolveIndexFlatIP", () => {
  test("reads IndexFlatIP from ESM default export", () => {
    const IndexFlatIP = class {};
    const resolved = resolveIndexFlatIP({ default: { IndexFlatIP } });
    expect(resolved).toBe(IndexFlatIP);
  });

  test("reads IndexFlatIP from CJS namespace root", () => {
    const IndexFlatIP = class {};
    const resolved = resolveIndexFlatIP({ IndexFlatIP });
    expect(resolved).toBe(IndexFlatIP);
  });

  test("reads IndexFlatIP from module.exports interop", () => {
    const IndexFlatIP = class {};
    const resolved = resolveIndexFlatIP({ "module.exports": { IndexFlatIP } });
    expect(resolved).toBe(IndexFlatIP);
  });

  test("returns null when missing", () => {
    expect(resolveIndexFlatIP({})).toBeNull();
  });
});

describe("paths", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  test("toPosixPath normalizes backslashes", () => {
    expect(toPosixPath("wiki\\foo\\bar.md")).toBe("wiki/foo/bar.md");
  });

  test("resolveVaultRoot uses AIO_VAULT_PATH", () => {
    process.env.AIO_VAULT_PATH = "D:\\custom\\vault";
    delete process.env.OBSIDIAN_VAULT_PATH;
    expect(resolveVaultRoot()).toBe(path.resolve("D:\\custom\\vault"));
  });

  test("resolveVaultRoot uses explicit argument over env", () => {
    process.env.AIO_VAULT_PATH = "D:\\custom\\vault";
    expect(resolveVaultRoot("D:\\explicit\\vault")).toBe(path.resolve("D:\\explicit\\vault"));
  });

  test("resolveVaultRoot defaults to <project>/vault via AIO_PROJECT_ROOT", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aio-proj-"));
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    process.env.AIO_PROJECT_ROOT = tmp;
    delete process.env.AIO_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;
    expect(resolveVaultRoot()).toBe(path.join(tmp, "vault"));
  });

  test("resolveProjectRoot prefers AIO_PROJECT_ROOT", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aio-root-"));
    process.env.AIO_PROJECT_ROOT = tmp;
    expect(resolveProjectRoot()).toBe(path.resolve(tmp));
  });
});
