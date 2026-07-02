// MyAnimeList tracking. Updates your MAL reading progress as you read.
//
// Setup (one-time): create an API app at https://myanimelist.net/apiconfig with
// App Redirect URL = http://localhost:8723/callback, then put its Client ID in
// config as "malClientId" (or the MAL_CLIENT_ID env var) and run `mal login`.
// MAL's OAuth2 uses PKCE with the "plain" method (challenge == verifier).

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "./paths.ts";

const MAL_FILE = join(CONFIG_DIR, "mal.json");
const OAUTH = "https://myanimelist.net/v1/oauth2";
const API = "https://api.myanimelist.net/v2";
export const MAL_REDIRECT_PORT = 8723;
export const MAL_REDIRECT_URI = `http://localhost:${MAL_REDIRECT_PORT}/callback`;

interface MalToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
interface MalStore {
  token?: MalToken;
  mangaIds?: Record<string, number | null>;
  /** PKCE verifier/state saved between `mal login` and `mal login <url>`. */
  pending?: { verifier: string; state: string };
}

async function load(): Promise<MalStore> {
  try {
    const f = Bun.file(MAL_FILE);
    return (await f.exists()) ? ((await f.json()) as MalStore) : {};
  } catch {
    return {};
  }
}
async function save(s: MalStore): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await Bun.write(MAL_FILE, JSON.stringify(s, null, 2));
}

export async function malLoggedIn(): Promise<boolean> {
  return Boolean((await load()).token);
}
export async function malLogout(): Promise<void> {
  const s = await load();
  delete s.token;
  await save(s);
}

function randomString(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

/**
 * Step 1 of login: build the authorize URL + PKCE verifier/state. The caller opens
 * the URL, the user approves, then pastes the redirect URL/code back (no local
 * server — that's fragile on modern macOS and behind the process lifecycle).
 */
export async function malBeginLogin(clientId: string): Promise<{ authUrl: string }> {
  const verifier = randomString(96); // MAL "plain" PKCE → challenge == verifier
  const state = randomString(16);
  const authUrl =
    `${OAUTH}/authorize?response_type=code&client_id=${clientId}` +
    `&code_challenge=${verifier}&code_challenge_method=plain&state=${state}` +
    `&redirect_uri=${encodeURIComponent(MAL_REDIRECT_URI)}`;
  const store = await load();
  store.pending = { verifier, state };
  await save(store);
  return { authUrl };
}

/** Finish login from a pasted redirect URL (or bare code), using the saved PKCE state. */
export async function malCompleteFromInput(
  clientId: string,
  clientSecret: string,
  input: string,
): Promise<{ ok: boolean; message: string }> {
  const store = await load();
  if (!store.pending) {
    return { ok: false, message: "no login in progress — run `manga-cli mal login` first" };
  }
  const code = extractCode(input, store.pending.state);
  if (!code) {
    return {
      ok: false,
      message: "couldn't read a valid code (state didn't match?) — re-run `mal login` and use THAT run's URL",
    };
  }
  const r = await malCompleteLogin(clientId, clientSecret, code, store.pending.verifier);
  if (r.ok) {
    delete store.pending;
    await save(store);
  }
  return r;
}

/** Pull the authorization code out of a pasted redirect URL (or a bare code). */
export function extractCode(pasted: string, expectedState?: string): string | null {
  const input = pasted.trim();
  if (!input) return null;
  if (input.includes("code=")) {
    try {
      const u = new URL(input.includes("://") ? input : "http://x/?" + input.replace(/^[?]/, ""));
      const code = u.searchParams.get("code");
      const st = u.searchParams.get("state");
      if (expectedState && st && st !== expectedState) return null;
      if (code) return code;
    } catch {
      // fall through to regex
    }
    const m = input.match(/code=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  return input; // assume the user pasted just the code
}

/** Step 2: exchange the code for tokens and store them. */
export async function malCompleteLogin(
  clientId: string,
  clientSecret: string,
  code: string,
  verifier: string,
): Promise<{ ok: boolean; message: string }> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: MAL_REDIRECT_URI,
  };
  if (clientSecret) params.client_secret = clientSecret;
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    return { ok: false, message: `token exchange failed (HTTP ${res.status}): ${(await res.text()).slice(0, 160)}` };
  }
  const tok = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const store = await load();
  store.token = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + tok.expires_in * 1000,
  };
  await save(store);
  return { ok: true, message: "linked" };
}

async function validToken(clientId: string, clientSecret = ""): Promise<string | null> {
  const store = await load();
  if (!store.token) return null;
  if (store.token.expires_at > Date.now() + 60_000) return store.token.access_token;
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: store.token.refresh_token,
  };
  if (clientSecret) params.client_secret = clientSecret;
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  store.token = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + tok.expires_in * 1000,
  };
  await save(store);
  return tok.access_token;
}

/** The linked account's username (or null if not linked / token invalid). */
export async function malWhoAmI(clientId: string, clientSecret = ""): Promise<string | null> {
  const token = await validToken(clientId, clientSecret);
  if (!token) return null;
  const res = await fetch(`${API}/users/@me?fields=name`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { name?: string }).name ?? "user";
}

async function findMangaId(token: string, title: string): Promise<number | null> {
  const store = await load();
  store.mangaIds ??= {};
  if (title in store.mangaIds) return store.mangaIds[title];
  let id: number | null = null;
  const res = await fetch(`${API}/manga?q=${encodeURIComponent(title.slice(0, 64))}&limit=5&fields=id,title`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const data = (await res.json()) as { data?: Array<{ node: { id: number; title: string } }> };
    const nodes = (data.data ?? []).map((d) => d.node);
    const exact = nodes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    id = (exact ?? nodes[0])?.id ?? null;
  }
  store.mangaIds[title] = id;
  await save(store);
  return id;
}

/** Update reading progress for a title on MAL. Returns true on success. */
export async function malUpdateProgress(
  clientId: string,
  clientSecret: string,
  title: string,
  chaptersRead: number,
): Promise<boolean> {
  const token = await validToken(clientId, clientSecret);
  if (!token) return false;
  const id = await findMangaId(token, title);
  if (!id) return false;
  const res = await fetch(`${API}/manga/${id}/my_list_status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ num_chapters_read: String(Math.max(0, Math.floor(chaptersRead))), status: "reading" }),
  });
  return res.ok;
}
