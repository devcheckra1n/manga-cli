// Low-level HTTP client for atsu.moe: shared headers, timeout, jitter, error mapping.

const ORIGIN = "https://atsu.moe";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10_000;

export { ORIGIN };

// Read at call time so a late `process.env` change (from `--debug`) still applies.
function debugEnabled(): boolean {
  return process.env.MANGA_CLI_DEBUG === "1";
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        ...(init?.headers as Record<string, string> | undefined),
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return ORIGIN + "/";
  }
}

/**
 * Generic GET → JSON for source adapters (MangaDex etc). `url` must already carry
 * its query string (sources that need repeated/bracket params build it themselves).
 */
export async function httpJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  if (debugEnabled()) console.error(`[api] GET ${url}`);
  await jitter();
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: opts.headers }, opts.timeoutMs);
  } catch (e) {
    throw new ApiError(`Could not reach ${originOf(url)} (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(`Request failed (HTTP ${res.status})${body ? ": " + body.slice(0, 160) : ""}`, res.status);
  }
  return (await res.json()) as T;
}

// A little jitter so we never hammer the origin in a tight loop.
function jitter(): Promise<void> {
  return new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
}

const NETWORK_HINT =
  "Could not reach atsu.moe. Check your connection — the site blocks some ISPs; " +
  "try 1.1.1.1 DNS or a VPN.";

/** GET a JSON endpoint. `path` may be absolute or origin-relative. */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : ORIGIN + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  if (debugEnabled()) console.error(`[api] GET ${url.toString()}`);
  await jitter();

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), { headers: { Referer: ORIGIN + "/" } });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ApiError(`${NETWORK_HINT} (${reason})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(
      `Request to ${path} failed (HTTP ${res.status})${body ? ": " + body.slice(0, 180) : ""}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

/** Generic GET → text, for HTML/RSS sources (weebcentral, nyaa). */
export async function httpText(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  if (debugEnabled()) console.error(`[api] GET ${url}`);
  await jitter();
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: opts.headers }, opts.timeoutMs);
  } catch (e) {
    throw new ApiError(`Could not reach ${originOf(url)} (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) throw new ApiError(`Request failed (HTTP ${res.status})`, res.status);
  return res.text();
}

/** Fetch a binary asset (image). Returns null on any failure (caller shows a placeholder). */
export async function fetchBinary(url: string): Promise<ArrayBuffer | null> {
  const abs = resolveAssetUrl(url);
  if (debugEnabled()) console.error(`[api] IMG ${abs}`);
  try {
    const res = await fetchWithTimeout(abs, { headers: { Referer: originOf(abs) } });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Resolve a relative asset path from the API into an absolute URL on the origin.
 * `fetch` then follows the origin's 302 to cdn.atsu.moe for page images.
 *   "/static/posters/x.jpg" -> origin + "/static/posters/x.jpg"
 *   "posters/x.jpg"         -> origin + "/static/posters/x.jpg"
 *   "/static/pages/.../0.webp" -> origin (redirects to CDN)
 */
export function resolveAssetUrl(p: string): string {
  if (p.startsWith("http")) return p;
  let path = p.startsWith("/") ? p : "/" + p;
  if (!path.startsWith("/static/")) path = "/static" + path;
  return ORIGIN + path;
}
