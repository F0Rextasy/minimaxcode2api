// MiniMax Code OAuth: device flow (PKCE S256) + refresh.
//
//   1) POST {account}/oauth2/device/code
//        client_id, scope, audience, code_challenge, code_challenge_method=S256
//        -> user_code, verification_uri(_complete), device_code (sometimes
//           absent — MiniMax's variant polls with the user_code itself)
//   2) POST {account}/oauth2/token   (one POST per poll)
//        grant_type=urn:ietf:params:oauth:grant-type:device_code,
//        device_code|user_code, client_id, code_verifier
//        -> {status: pending|slow_down|denied|expired} on 200 with the tokens
//           arriving as {access_token, refresh_token, expires_in}
//   3) POST {account}/oauth2/token   (refresh; refresh tokens are single-use)
//        grant_type=refresh_token, refresh_token, client_id, scope, audience

import crypto from "node:crypto";
import { CLIENT_ID, SCOPE, AUDIENCE, DEVICE_GRANT, endpoints } from "./config.js";
import { request } from "./http.js";

const str = (o, k) => (typeof o?.[k] === "string" && o[k].trim() ? o[k].trim() : undefined);
const num = (o, k) => (typeof o?.[k] === "number" && Number.isFinite(o[k]) && o[k] > 0 ? o[k] : undefined);

async function postForm(url, fields) {
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") body = { error: `invalid_json_response (HTTP ${res.status})`, raw: text.slice(0, 300) };
  return { status: res.status, body };
}

export function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function normalizeDeadline(body) {
  const expiredIn = num(body, "expired_in") ?? num(body, "expires_in");
  if (!expiredIn) return undefined;
  // MiniMax has shipped both ms-epoch and seconds here.
  const seconds = expiredIn > 10_000_000 ? Math.max(1, Math.floor((expiredIn - Date.now()) / 1000)) : expiredIn;
  return Math.floor(seconds);
}

function normalizeInterval(body, pollByUser) {
  const raw = num(body, "interval");
  if (!raw) return pollByUser ? 5 : 2;
  return pollByUser && raw > 100 ? Math.max(1, Math.round(raw / 1000)) : raw;
}

export async function requestDeviceCode(codeChallenge) {
  const { deviceUrl } = endpoints();
  const { status, body } = await postForm(deviceUrl, {
    client_id: CLIENT_ID,
    scope: SCOPE,
    audience: AUDIENCE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const userCode = str(body, "user_code");
  const deviceCode = str(body, "device_code");
  const uri = str(body, "verification_uri_complete") ?? str(body, "verification_uri") ?? str(body, "verification_url");
  if (status >= 400 || !userCode || !uri) {
    throw new Error(`device code request failed (HTTP ${status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  const pollByUser = !deviceCode;
  return {
    deviceCode: deviceCode ?? userCode,
    userCode,
    verificationUri: uri,
    expiresIn: normalizeDeadline(body) ?? 600,
    interval: normalizeInterval(body, pollByUser),
    pollByUser,
    _status: status,
  };
}

export async function pollToken(device, codeVerifier) {
  const { tokenUrl } = endpoints();
  const fields = {
    grant_type: DEVICE_GRANT,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    ...(device.pollByUser ? { user_code: device.deviceCode } : { device_code: device.deviceCode }),
  };
  const { status, body } = await postForm(tokenUrl, fields);

  const st = str(body, "status");
  if (st === "pending") return { pending: "authorization_pending" };
  if (st === "slow_down") return { pending: "slow_down" };
  if (st === "denied" || st === "access_denied") return { error: "access_denied" };
  if (st === "expired" || st === "expired_token") return { error: "expired_token" };
  if (st) return { error: `unexpected_status:${st}` };
  if (str(body, "error")) return { error: `${str(body, "error")}${str(body, "error_description") ? `: ${str(body, "error_description")}` : ""}` };
  if (!str(body, "access_token")) return { error: `no_access_token (HTTP ${status})` };
  return { tokens: body };
}

export async function refreshToken(refreshTokenValue) {
  const { tokenUrl } = endpoints();
  const { body } = await postForm(tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
    client_id: CLIENT_ID,
    scope: SCOPE,
    audience: AUDIENCE,
  });
  if (!str(body, "access_token")) return null;
  return body;
}

/** Full sign-in for the CLI: prints the code, polls until approved. */
export async function loginFlow({ log = console.log, now = () => Date.now(), signal } = {}) {
  const { verifier, challenge } = pkce();
  const device = await requestDeviceCode(challenge);
  log("");
  log(`  1) Open:  ${device.verificationUri}`);
  log(`  2) Code:  ${device.userCode}`);
  log("");
  log(`  Waiting for approval (up to ${Math.ceil(device.expiresIn / 60)} min)...`);

  let interval = Math.max(1, device.interval || 3) * 1000;
  const deadline = now() + device.expiresIn * 1000;
  for (;;) {
    if (signal?.aborted) throw new Error("login aborted");
    if (now() > deadline) throw new Error("device code expired before approval");
    await new Promise((r) => setTimeout(r, interval));
    const res = await pollToken(device, verifier);
    if (res.tokens) return res.tokens;
    if (res.pending === "slow_down") {
      interval += 2000;
      continue;
    }
    if (res.pending) continue;
    throw new Error(`sign-in failed: ${res.error}`);
  }
}
