// Local HTTP server: OpenAI-compatible facade over the MiniMax Code account.
//
//   GET  /healthz              liveness + sign-in state
//   GET  /v1/models            catalog (live upstream when signed in)
//   POST /v1/chat/completions  OpenAI shape (stream + tools)
//   POST /v1/messages          Anthropic passthrough for Claude Code clients

import http from "node:http";
import { config, KNOWN_MODELS, DEFAULT_MODEL } from "./config.js";
import * as store from "./store.js";
import { UpstreamError, messages, fetchModels } from "./upstream.js";
import { toAnthropic, toOpenAI, anthropicStreamToOpenAI } from "./translate.js";

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    ...extra,
  });
  res.end(payload);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!config.apiKey) return true;
  const header = req.headers.authorization || "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return key === config.apiKey;
}

// Anthropic SSE -> line iterator
async function* sseLines(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function upstreamError(res, err) {
  if (err instanceof UpstreamError) {
    const status = err.status === 401 || err.status === 403 ? 401 : err.status >= 500 ? 502 : err.status || 502;
    return json(res, status, { error: { message: err.message, type: "upstream_error", code: String(err.status || 502) } });
  }
  return json(res, 500, { error: { message: err?.message || "internal error", type: "server_error" } });
}

async function handleModels(res) {
  const live = await fetchModels().catch(() => null);
  const list = live?.length ? live : KNOWN_MODELS;
  const data = list.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: "minimax-code", name: m.name || m.id }));
  json(res, 200, { object: "list", data });
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req) || "{}");
  } catch (err) {
    return json(res, 400, { error: { message: `invalid JSON body: ${err.message}`, type: "invalid_request_error" } });
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return json(res, 400, { error: { message: "messages[] is required", type: "invalid_request_error" } });
  }

  const model = body.model || DEFAULT_MODEL;
  const upstreamBody = toAnthropic({ ...body, model });

  let upstream;
  try {
    upstream = await messages(upstreamBody);
  } catch (err) {
    return upstreamError(res, err);
  }

  if (!body.stream) {
    const data = await upstream.json().catch(() => null);
    if (!data) return json(res, 502, { error: { message: "upstream returned non-JSON", type: "upstream_error" } });
    return json(res, 200, toOpenAI(data, model));
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  try {
    for await (const chunk of anthropicStreamToOpenAI(sseLines(upstream.body), model)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: { message: err?.message || "stream error", type: "upstream_error" } })}\n\n`);
    res.end();
  }
}

// Anthropic-native passthrough (Claude Code / any Anthropic client).
async function handleMessages(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req) || "{}");
  } catch (err) {
    return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: `invalid JSON body: ${err.message}` } });
  }
  if (body?.model && !String(body.model).startsWith("MiniMax")) body.model = DEFAULT_MODEL;

  let upstream;
  try {
    upstream = await messages(body);
  } catch (err) {
    return upstreamError(res, err);
  }

  if (!body.stream) {
    const text = await upstream.text();
    res.writeHead(upstream.status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(text);
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-api-key, anthropic-version",
      });
      return res.end();
    }

    if (url.pathname === "/healthz") {
      const entry = store.get();
      return json(res, 200, {
        ok: true,
        site: store.siteKey(),
        signedIn: !!entry?.accessToken,
        expiresAt: entry?.expiresAt || null,
      });
    }

    if (url.pathname === "/v1/models" && req.method === "GET") return handleModels(res);

    const route = `${req.method} ${url.pathname}`;
    const known = ["POST /v1/chat/completions", "POST /v1/messages"];
    if (!known.includes(route)) {
      return json(res, 404, { error: { message: `no route for ${route}`, type: "invalid_request_error" } });
    }

    if (!authorized(req)) {
      return json(res, 401, { error: { message: "invalid API key", type: "invalid_request_error", code: "invalid_api_key" } });
    }

    if (url.pathname === "/v1/chat/completions") return handleChat(req, res);
    return handleMessages(req, res);
  });
}

/** Start the server; resolves with { server, url } when listening. */
export function serve({ port = config.port, host = config.host } = {}) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const bound = server.address();
      const actualPort = typeof bound === "object" && bound ? bound.port : port;
      resolve({ server, url: `http://${host}:${actualPort}`, port: actualPort });
    });
  });
}
