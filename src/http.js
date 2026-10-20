// One request entry point for the whole bridge.
//
//   - No proxy configured (or a loopback target): native fetch.
//   - Proxy configured (env MINIMAXCODE_PROXY): the request goes through the
//     HTTP-CONNECT / SOCKS5 tunnel in ./proxy.js and never touches the local
//     connection's egress.
//
// The returned object carries the slice of the fetch Response API this bridge
// uses: status, ok, statusText, headers.get(), text(), json(), and an async
// iterable `body` of Uint8Array chunks for SSE.
//
// Users choose. The bridge itself never forces a proxy, but when MINIMAXCODE_PROXY
// is set, every upstream call (OAuth device flow, token refresh, models, chat)
// is fail-closed: no exit, no request.

import http from "node:http";
import https from "node:https";
import { parseProxy, createAgent, isLocalHost, label } from "./proxy.js";
import { config } from "./config.js";

let cached = null;

function proxyState() {
  if (cached) return cached;
  if (!config.proxy) cached = { proxy: null };
  else {
    const proxy = parseProxy(config.proxy);
    if (!proxy) throw new Error(`MINIMAXCODE_PROXY is not a parseable proxy line: ${config.proxy}`);
    cached = { proxy };
  }
  return cached;
}

/** The proxy this URL would use, or null for a direct/loopback call. */
export function proxyFor(url) {
  const { proxy } = proxyState();
  if (!proxy) return null;
  const target = new URL(url);
  if (isLocalHost(target.hostname)) return null;
  return proxy;
}

function agentFor(proxy, secure) {
  proxy.agents ||= {};
  const key = secure ? "https" : "http";
  proxy.agents[key] ||= createAgent(proxy, { secure });
  return proxy.agents[key];
}

function headerBag(headers) {
  return {
    get(name) {
      const v = headers[String(name).toLowerCase()];
      return Array.isArray(v) ? v.join(", ") : v ?? null;
    },
    raw: headers,
  };
}

/**
 * A fetch-shaped request. Falls back to the native fetch when no proxy applies,
 * so the untunnelled path keeps exactly the platform behaviour.
 */
export async function request(url, { method = "GET", headers = {}, body, signal } = {}) {
  const proxy = proxyFor(url);
  if (!proxy) return fetch(url, { method, headers, body, signal });

  const target = new URL(url);
  const secure = target.protocol === "https:";
  const mod = secure ? https : http;
  const agent = agentFor(proxy, secure);

  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      { method, headers, agent, servername: target.hostname },
      (res) => {
        const chunks = [];
        let consumed = false;
        const readable = res[Symbol.asyncIterator].bind(res);

        const text = async () => {
          for await (const chunk of res) chunks.push(chunk);
          consumed = true;
          return Buffer.concat(chunks).toString("utf8");
        };
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusText: res.statusMessage || "",
          headers: headerBag(res.headers),
          url,
          proxy: label(proxy),
          text,
          async json() {
            return JSON.parse(await text());
          },
          // Streaming consumers use `body`; buffering consumers use text()/json().
          get body() {
            if (consumed) throw new Error("response body already consumed");
            return { [Symbol.asyncIterator]: readable };
          },
        });
      },
    );

    req.on("error", (err) => reject(new Error(`request via ${label(proxy)} failed: ${err.message}`)));
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error("aborted"));
        return reject(new Error("aborted"));
      }
      signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}
