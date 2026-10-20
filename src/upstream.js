// Upstream calls against the MiniMax Code agent gateway.
//
// Everything rides the Anthropic Messages endpoint. The gateway wants the
// official client's headers next to the Bearer token: a placeholder x-api-key,
// the agent id, a session id and the timezone offset.

import crypto from "node:crypto";
import { AGENT_ID, USER_AGENT, ANTHROPIC_VERSION, endpoints } from "./config.js";
import * as store from "./store.js";
import { refreshToken } from "./oauth.js";
import { request } from "./http.js";

export class UpstreamError extends Error {
  constructor(status, body, message) {
    super(message || `upstream HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function upstreamHeaders(accessToken) {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${accessToken}`,
    "x-api-key": "sk-xxx",
    "anthropic-version": ANTHROPIC_VERSION,
    "user-agent": USER_AGENT,
    "x-mavis-agent-id": AGENT_ID,
    "x-mavis-timezone-offset": String(new Date().getTimezoneOffset() * -60),
    "x-mavis-session-id": crypto.randomUUID(),
  };
}

/** Current access token, refreshing when it is close to expiry. */
export async function accessToken() {
  let entry = store.get();
  if (!entry?.accessToken) throw new UpstreamError(401, null, "not signed in — run `minimaxcode2api login`");
  if (store.isExpired(entry)) {
    const refreshed = await store.refresh(entry, refreshToken);
    if (!refreshed) throw new UpstreamError(401, null, "token expired and refresh failed — sign in again");
    entry = refreshed;
  }
  return entry.accessToken;
}

/** POST /messages with one refresh-and-retry on 401. */
export async function messages(body, { signal } = {}) {
  const { messagesUrl } = endpoints();
  let token = await accessToken();

  const send = async (t) =>
    request(messagesUrl, {
      method: "POST",
      headers: upstreamHeaders(t),
      body: JSON.stringify(body),
      signal,
    });

  let res = await send(token);
  if (res.status === 401 || res.status === 403) {
    // One refresh, one retry — refresh tokens are single-use, the store dedups.
    const entry = store.get();
    const refreshed = await store.refresh(entry, refreshToken).catch(() => null);
    if (refreshed?.accessToken) {
      token = refreshed.accessToken;
      res = await send(token);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const msg = parsed?.error?.message || parsed?.message || parsed?.base_resp?.status_msg || text.slice(0, 300) || res.statusText;
    throw new UpstreamError(res.status, parsed ?? text, msg);
  }
  return res;
}

/** Live model catalog from the gateway; falls back to null when unauthorized. */
export async function fetchModels() {
  const { modelsUrl } = endpoints();
  let token;
  try {
    token = await accessToken();
  } catch {
    return null;
  }
  const res = await request(modelsUrl, {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": USER_AGENT,
      "x-mavis-agent-id": AGENT_ID,
      accept: "application/json",
    },
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const list = data?.providers?.flatMap?.((p) => p?.config?.models ?? []) ?? data?.models ?? data?.data ?? null;
  if (!Array.isArray(list)) return null;
  return list
    .map((m) => ({
      id: m?.model || m?.id || m?.model_name || m?.name,
      name: m?.display_name || m?.name || m?.model || m?.id,
    }))
    .filter((m) => m.id);
}

/** Quick "is this account alive" call for `status`. */
export async function probe() {
  const res = await messages({ model: "MiniMax-M2.7", max_tokens: 1, messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }] });
  return res.ok;
}
