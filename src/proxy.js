// Dependency-free proxy plumbing: HTTP CONNECT and SOCKS5 tunnels plus agents
// that make node:https talk through them.
//
// Adapted from the workspace's battle-tested `river-bulk-apikey/src/proxy.js`
// (SOCKS5 / HTTP-CONNECT tunnels, two-phase timeouts). Trimmed to what a bridge
// needs: parse a proxy line, open a tunnel, expose http.https agents.

import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";

// A dead exit must free its socket fast, while a live line on a flapping path
// may legitimately need ~30 s for the TLS handshake.
const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 35000;

/** Accepted shapes: host:port · host:port:user:pass · user:pass@host:port · scheme://[creds@]host:port · host|port|user|pass */
export function parseProxy(line, { defaultProtocol = "http" } = {}) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  let protocol = defaultProtocol;
  let rest = raw;
  const scheme = raw.match(/^([a-z0-9]+):\/\/(.+)$/i);
  if (scheme) {
    protocol = scheme[1].toLowerCase();
    rest = scheme[2];
  } else if (raw.includes("|")) {
    const parts = raw.split("|").map((p) => p.trim());
    return build(protocol, parts[0], parts[1], parts[2], parts[3], raw);
  }

  let username;
  let password;
  let hostport = rest;
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    const creds = rest.slice(0, at);
    hostport = rest.slice(at + 1);
    const colon = creds.indexOf(":");
    if (colon === -1) username = creds;
    else {
      username = creds.slice(0, colon);
      password = creds.slice(colon + 1);
    }
  }

  let host;
  let port;
  let extraUser;
  let extraPass;
  const bits = hostport.split(":");
  if (bits.length === 4) [host, port, extraUser, extraPass] = bits;
  else if (bits.length === 2) [host, port] = bits;
  else return null;
  if (extraUser !== undefined && username === undefined) {
    username = extraUser;
    password = extraPass;
  }
  return build(protocol, host, port, username, password, raw);
}

function build(protocol, host, port, username, password, raw) {
  const p = String(protocol || "http").toLowerCase();
  const normalized =
    p === "https" ? "https" : p === "socks4" || p === "socks4a" ? "socks4" : p.startsWith("socks") ? "socks5" : "http";
  const portNum = parseInt(port, 10);
  if (!host || !Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) return null;
  return {
    raw,
    protocol: normalized,
    host: String(host).replace(/^\[|\]$/g, ""),
    port: portNum,
    username: username || undefined,
    password: password || undefined,
  };
}

export function label(proxy) {
  return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
}

/** Loopback / link-local / RFC1918 — never worth tunnelling, and a "proxy" there would leak. */
export function isLocalHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h.endsWith(".localhost")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function once(emitter, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`timeout waiting for ${event} (${timeoutMs}ms)`)), timeoutMs);
    const onEvent = (...args) => finish(null, args);
    const onError = (err) => finish(err);
    const finish = (err, args) => {
      clearTimeout(timer);
      emitter.removeListener(event, onEvent);
      emitter.removeListener("error", onError);
      if (err) reject(err);
      else resolve(args);
    };
    emitter.once(event, onEvent);
    emitter.once("error", onError);
  });
}

// ---------------------------------------------------------------- HTTP CONNECT

function connectHttpProxy(proxy, { host, port, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`proxy CONNECT timeout (${label(proxy)})`)), timeoutMs);
    socket.on("error", (e) => {
      clearTimeout(timer);
      fail(new Error(`proxy connect failed (${label(proxy)}): ${e.message}`));
    });
    socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.removeListener("data", onData);
      clearTimeout(timer);
      const head = buffer.slice(0, end).toString("latin1");
      const status = parseInt((head.split("\r\n")[0].match(/^HTTP\/\d\.\d (\d{3})/) || [])[1], 10);
      if (status !== 200) {
        const hint = status === 407 ? " (proxy auth required/rejected)" : status === 403 ? " (proxy refused destination)" : "";
        return fail(new Error(`proxy CONNECT ${status || "garbage"}${hint} via ${label(proxy)}`));
      }
      if (settled) return;
      settled = true;
      const rest = buffer.slice(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on("data", onData);

    socket.on("connect", () => {
      const headers = [
        `CONNECT ${host}:${port} HTTP/1.1`,
        `Host: ${host}:${port}`,
        "Proxy-Connection: Keep-Alive",
      ];
      if (proxy.username) {
        headers.push(`Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64")}`);
      }
      socket.write(headers.join("\r\n") + "\r\n\r\n");
    });
  });
}

// -------------------------------------------------------------------- SOCKS5

function connectSocks5(proxy, { host, port, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`SOCKS5 timeout (${label(proxy)})`)), timeoutMs);
    socket.on("error", (e) => fail(new Error(`SOCKS5 connect failed (${label(proxy)}): ${e.message}`)));
    socket.setNoDelay(true);

    let stage = "method";
    let buffer = Buffer.alloc(0);

    const sendRequest = () => {
      // ATYP=0x03 (domain) keeps DNS on the proxy: no local lookup leaks.
      const hostBuf = Buffer.from(host);
      socket.write(Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
        hostBuf,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
      ]));
    };

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "method") {
        if (buffer.length < 2) return;
        const method = buffer[1];
        buffer = buffer.slice(2);
        if (method === 0xff) return fail(new Error(`SOCKS5 proxy rejected auth methods (${label(proxy)})`));
        if (method === 0x02) {
          if (!proxy.username) return fail(new Error(`SOCKS5 proxy wants username/password (${label(proxy)})`));
          stage = "auth";
          const u = Buffer.from(proxy.username);
          const p = Buffer.from(proxy.password || "");
          socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
          return;
        }
        stage = "reply";
        return sendRequest();
      }
      if (stage === "auth") {
        if (buffer.length < 2) return;
        const ok = buffer[1] === 0x00;
        buffer = buffer.slice(2);
        if (!ok) return fail(new Error(`SOCKS5 auth rejected (${label(proxy)})`));
        stage = "reply";
        return sendRequest();
      }
      if (buffer.length < 4) return;
      const rep = buffer[1];
      const atyp = buffer[3];
      const need = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : 7 + buffer[4];
      if (buffer.length < need) return;
      if (rep !== 0x00) {
        const reasons = { 1: "general failure", 2: "not allowed", 3: "network unreachable", 4: "host unreachable", 5: "connection refused", 6: "TTL expired", 7: "command not supported", 8: "address type not supported" };
        return fail(new Error(`SOCKS5 error ${reasons[rep] || rep} (${label(proxy)})`));
      }
      clearTimeout(timer);
      const rest = buffer.slice(need);
      if (settled) return;
      settled = true;
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on("data", onData);

    socket.on("connect", () => {
      const methods = proxy.username ? [0x00, 0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
    });
  });
}

export function openTunnel(proxy, { host, port, timeoutMs } = {}) {
  if (proxy.protocol === "socks5") return connectSocks5(proxy, { host, port, timeoutMs });
  return connectHttpProxy(proxy, { host, port, timeoutMs });
}

// --------------------------------------------------------------------- agents

/**
 * Agent whose sockets are opened through the proxy; TLS targets are wrapped in
 * TLS locally, so `https.request({ agent })` transparently exits via the proxy.
 */
export class ProxyAgent extends https.Agent {
  constructor(proxy, options = {}) {
    super({ keepAlive: false, ...options });
    this.proxy = proxy;
  }

  createConnection(options, callback) {
    const host = options.host;
    const port = Number(options.port) || 443;
    let tunnel = null;
    const connectMs = this.proxy.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
    const handshakeMs = this.proxy.timeoutMs || DEFAULT_HANDSHAKE_TIMEOUT_MS;
    openTunnel(this.proxy, { host, port, timeoutMs: connectMs })
      .then((socket) => {
        tunnel = socket;
        if (options.secureEndpoint === false) return socket;
        const tlsSocket = tls.connect({
          socket,
          servername: options.servername || host,
          rejectUnauthorized: this.proxy.rejectUnauthorized !== false,
        });
        return once(tlsSocket, "secureConnect", handshakeMs).then(() => tlsSocket);
      })
      .then((socket) => callback(null, socket))
      .catch((err) => {
        if (tunnel) tunnel.destroy();
        callback(err);
      });
  }
}

export class HttpProxyAgent extends http.Agent {
  constructor(proxy, options = {}) {
    super({ keepAlive: false, ...options });
    this.proxy = proxy;
  }

  createConnection(options, callback) {
    const host = options.host;
    const port = Number(options.port) || 80;
    openTunnel(this.proxy, { host, port, timeoutMs: this.proxy.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS })
      .then((socket) => callback(null, socket))
      .catch((err) => callback(err));
  }
}

export function createAgent(proxy, { secure = true, ...options } = {}) {
  return secure ? new ProxyAgent(proxy, options) : new HttpProxyAgent(proxy, options);
}
