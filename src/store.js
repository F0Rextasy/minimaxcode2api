// Token store + refresh discipline.
//
// MiniMax refresh tokens are SINGLE USE: a second refresh with the same token
// returns invalid_grant and can kill the account slot. So all refreshes go
// through a single-flight map, and every token we already spent is remembered
// in a small ring so a retry cannot burn a second time.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "./config.js";

const defaultPath = path.join(os.homedir(), ".minimaxcode2api", "tokens.json");

export function storePath() {
  return config.storePath || defaultPath;
}

// The cache is mtime-guarded: a second consumer (the daily check-in keeper)
// rotates the token file while this process keeps running, and a stale cache
// would make our next refresh spend a refresh token that is already gone.
let cache = null;
let cacheMtime = 0;

export function load() {
  const file = storePath();
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {}
  if (cache && mtime === cacheMtime) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    cache = {};
  }
  cacheMtime = mtime;
  return cache;
}

export function save(next) {
  cache = next;
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  try {
    cacheMtime = fs.statSync(file).mtimeMs;
  } catch {
    cacheMtime = 0;
  }
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  return cache;
}

// One entry per MiniMax site: the site *is* the account identity, so a custom
// base URL (mirror / test mock) does not fork the token slot.
export function siteKey() {
  return config.site === "global" ? "global" : "cn";
}

export function get() {
  return load()[siteKey()] || null;
}

export function set(entry) {
  const all = load();
  all[siteKey()] = { ...(all[siteKey()] || {}), ...entry, updatedAt: Date.now() };
  return save(all)[siteKey()];
}

export function clear() {
  const all = load();
  delete all[siteKey()];
  save(all);
}

export function isExpired(entry, leadMs = 120_000) {
  if (!entry?.accessToken) return true;
  if (!entry?.expiresAt) return false;
  return Date.now() > entry.expiresAt - leadMs;
}

// ── spent-token ring ─────────────────────────────────────────────────────────
const spent = new Set();
const SPENT_MAX = 40;

export function markSpent(token) {
  if (!token) return;
  spent.add(token);
  if (spent.size > SPENT_MAX) spent.delete(spent.values().next().value);
}

export function wasSpent(token) {
  return !!token && spent.has(token);
}

// ── single-flight refresh ────────────────────────────────────────────────────
const inflight = new Map();

/**
 * Refresh via `doRefresh(refreshToken)` and persist the result.
 * Returns the updated entry, or null when there is nothing to refresh.
 */
export async function refresh(entry, doRefresh) {
  const refreshToken = entry?.refreshToken;
  if (!refreshToken) return null;
  if (wasSpent(refreshToken)) return null;
  if (inflight.has(refreshToken)) return inflight.get(refreshToken);

  const job = (async () => {
    markSpent(refreshToken);
    const data = await doRefresh(refreshToken);
    if (!data?.access_token) return null;
    return set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    });
  })();

  inflight.set(refreshToken, job);
  try {
    return await job;
  } finally {
    inflight.delete(refreshToken);
  }
}
