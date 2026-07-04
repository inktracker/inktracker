// T2 acceptance: the offsite mirror uploads versioned objects to an
// S3-compatible endpoint and verifies them; without env it no-ops with a
// warning; with env and a failing endpoint it exits non-zero.
// Runs the real script as a subprocess against an in-process mock S3.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts", "offsite-mirror.mjs");

let server;
let port;
const store = new Map(); // key → byteLength
let failPuts = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = decodeURIComponent(req.url.split("?")[0]);
    if (req.method === "PUT") {
      if (failPuts) { res.statusCode = 500; return res.end("induced failure"); }
      let len = 0;
      req.on("data", (c) => (len += c.length));
      req.on("end", () => { store.set(key, len); res.statusCode = 200; res.end(); });
      return;
    }
    if (req.method === "HEAD") {
      if (!store.has(key)) { res.statusCode = 404; return res.end(); }
      res.setHeader("Content-Length", String(store.get(key)));
      res.statusCode = 200;
      return res.end();
    }
    res.statusCode = 400;
    res.end();
  });
  await new Promise((r) => server.listen(0, () => r()));
  port = server.address().port;
});
afterAll(() => server.close());

async function makeBackupDir() {
  const dir = await mkdtemp(join(tmpdir(), "mirror-test-"));
  await writeFile(join(dir, "quotes.jsonl"), '{"id":"a"}\n{"id":"b"}\n');
  await mkdir(join(dir, "nested"), { recursive: true });
  await writeFile(join(dir, "nested", "manifest.json"), "{}");
  return dir;
}

const s3env = () => ({
  ...process.env,
  BACKUP_S3_ENDPOINT: `http://127.0.0.1:${port}`,
  BACKUP_S3_BUCKET: "drill-offsite",
  BACKUP_S3_ACCESS_KEY_ID: "test",
  BACKUP_S3_SECRET_ACCESS_KEY: "test",
  BACKUP_S3_REGION: "auto",
});

describe("offsite-mirror", () => {
  it("uploads every file under a date-stamped prefix and verifies by HEAD", async () => {
    store.clear(); failPuts = false;
    const dir = await makeBackupDir();
    const { stdout } = await run("node", [SCRIPT, dir, "db"], { env: s3env() });
    expect(stdout).toMatch(/mirrored 2 object\(s\)/);
    const keys = [...store.keys()];
    expect(keys).toHaveLength(2);
    // versioned key shape: /<bucket>/db/<ISO-stamp>-run<id>/<relative path>
    expect(keys.every((k) => /^\/drill-offsite\/db\/\d{4}-\d{2}-\d{2}T[\d-]+Z-run/.test(k))).toBe(true);
    expect(keys.some((k) => k.endsWith("/quotes.jsonl"))).toBe(true);
    expect(keys.some((k) => k.endsWith("/nested/manifest.json"))).toBe(true);
  });

  it("re-running never overwrites: a new run gets a new prefix", async () => {
    store.clear(); failPuts = false;
    const dir = await makeBackupDir();
    await run("node", [SCRIPT, dir, "db"], { env: { ...s3env(), GITHUB_RUN_ID: "111" } });
    await run("node", [SCRIPT, dir, "db"], { env: { ...s3env(), GITHUB_RUN_ID: "222" } });
    expect(store.size).toBe(4); // 2 files × 2 distinct prefixes
  });

  it("no BACKUP_S3_* env → exits 0 with a loud skip warning", async () => {
    const dir = await makeBackupDir();
    const env = { ...process.env };
    delete env.BACKUP_S3_ENDPOINT; delete env.BACKUP_S3_BUCKET;
    delete env.BACKUP_S3_ACCESS_KEY_ID; delete env.BACKUP_S3_SECRET_ACCESS_KEY;
    const { stderr } = await run("node", [SCRIPT, dir, "db"], { env });
    expect(stderr).toMatch(/SKIPPING the offsite mirror/);
  });

  it("env set + endpoint failing → exits non-zero (silent offsite failure forbidden)", async () => {
    store.clear(); failPuts = true;
    const dir = await makeBackupDir();
    await expect(run("node", [SCRIPT, dir, "db"], { env: s3env() })).rejects.toMatchObject({ code: 1 });
  });

  it("empty backup dir is a failure, not a success", async () => {
    store.clear(); failPuts = false;
    const dir = await mkdtemp(join(tmpdir(), "mirror-empty-"));
    await expect(run("node", [SCRIPT, dir, "db"], { env: s3env() })).rejects.toMatchObject({ code: 1 });
  });
});
