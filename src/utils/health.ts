// Source health cache — persisted so it survives across CLI invocations. When a
// source fails (e.g. atsu.moe is down), we remember it for a short cooldown and
// skip it, instead of eating its network timeout on every command.
//
// A failure only counts against a source if the user's own internet is up —
// otherwise a flaky connection would flag every source as "down".

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR } from "./paths.ts";
import type { SourceId } from "../api/types.ts";

const HEALTH_FILE = join(CACHE_DIR, "health.json");
const COOLDOWN_MS = 5 * 60 * 1000; // skip a failed source for 5 minutes

// ── connectivity probe ─────────────────────────────────────────────────────────
// Tiny, highly-available endpoints (the same ones OSes use for captive-portal
// detection). If none answer quickly, the problem is the connection, not a source.
const PROBE_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://1.1.1.1/cdn-cgi/trace",
  "http://captive.apple.com/hotspot-detect.html",
];
const PROBE_TIMEOUT_MS = 3000;
const PROBE_TTL_MS = 15_000; // one verdict per command run, not per failing source

let lastProbe: { at: number; online: boolean } | null = null;

/** Is the user's own internet reachable? Memoized for a few seconds. */
export async function hasInternet(): Promise<boolean> {
  if (lastProbe && Date.now() - lastProbe.at < PROBE_TTL_MS) return lastProbe.online;
  let online: boolean;
  try {
    online = await Promise.any(
      PROBE_URLS.map(async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "manual" });
        if (res.status >= 500) throw new Error(`probe ${res.status}`);
        return true;
      }),
    );
  } catch {
    online = false;
  }
  lastProbe = { at: Date.now(), online };
  return online;
}

type HealthMap = Record<string, number>; // sourceId -> "failed until" epoch ms

async function load(): Promise<HealthMap> {
  try {
    const f = Bun.file(HEALTH_FILE);
    if (!(await f.exists())) return {};
    return (await f.json()) as HealthMap;
  } catch {
    return {};
  }
}

async function save(m: HealthMap): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await Bun.write(HEALTH_FILE, JSON.stringify(m));
  } catch {
    // best-effort
  }
}

/** Source ids currently inside their failure cooldown. */
export async function downSources(): Promise<Set<SourceId>> {
  const m = await load();
  const now = Date.now();
  const down = new Set<SourceId>();
  for (const [id, until] of Object.entries(m)) {
    if (until > now) down.add(id as SourceId);
  }
  return down;
}

/**
 * Record a source failure — but only if the internet itself is up. Returns true
 * if the source was actually marked (false = it was the user's connection).
 */
export async function markDown(id: SourceId): Promise<boolean> {
  if (!(await hasInternet())) return false; // bad connection — don't blame the source
  const m = await load();
  m[id] = Date.now() + COOLDOWN_MS;
  await save(m);
  return true;
}

export async function markUp(id: SourceId): Promise<void> {
  const m = await load();
  if (id in m) {
    delete m[id];
    await save(m);
  }
}

/** Forget all recorded failures (manga-cli sources reset). */
export async function clearHealth(): Promise<void> {
  try {
    await save({});
  } catch {
    // best-effort
  }
}
