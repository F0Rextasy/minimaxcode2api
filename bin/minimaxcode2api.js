#!/usr/bin/env node
// minimaxcode2api CLI:  login | serve | status | models | logout
//
// Global flags:
//   --site cn|global     MiniMax site (default cn)
//   --port <n>           serve port (default 8788)
//   --host <addr>        bind address (default 127.0.0.1)
//   --key <token>        require this bearer token on /v1/*
//   --store <path>       token store file (default ~/.minimaxcode2api/tokens.json)

const argv = process.argv.slice(2);

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

// Environment must be set before src/config.js is imported.
const site = flag("site");
if (typeof site === "string") process.env.MINIMAXCODE_SITE = site;
const port = flag("port");
if (port) process.env.MINIMAXCODE_PORT = String(port);
const host = flag("host");
if (typeof host === "string") process.env.MINIMAXCODE_HOST = host;
const key = flag("key");
if (typeof key === "string") process.env.MINIMAXCODE_KEY = key;
const storePath = flag("store");
if (typeof storePath === "string") process.env.MINIMAXCODE_STORE = storePath;
const proxy = flag("proxy");
if (typeof proxy === "string") process.env.MINIMAXCODE_PROXY = proxy;

const command = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith?.("--") === false) || argv[0] || "help";
const COMMANDS = new Set(["login", "serve", "status", "models", "logout", "help"]);
const cmd = COMMANDS.has(command) ? command : "help";

const { config, KNOWN_MODELS } = await import("../src/config.js");
const store = await import("../src/store.js");
const { loginFlow } = await import("../src/oauth.js");
const upstream = await import("../src/upstream.js");

function usage() {
  console.log(`minimaxcode2api — MiniMax Code account -> OpenAI-compatible API

Usage:
  minimaxcode2api login    [--site cn|global] [--proxy url]   sign in with the MiniMax Code device flow
  minimaxcode2api serve    [--port 8788] [--key k] [--proxy url]   start the local API
  minimaxcode2api status   [--proxy url]                      sign-in state + a 1-token upstream probe
  minimaxcode2api models   [--proxy url]                      list models (live when signed in)
  minimaxcode2api logout                                      drop the saved tokens

Env: MINIMAXCODE_SITE, MINIMAXCODE_PORT, MINIMAXCODE_HOST, MINIMAXCODE_KEY,
     MINIMAXCODE_STORE, MINIMAXCODE_PROXY, MINIMAXCODE_ACCOUNT_BASE, MINIMAXCODE_AGENT_BASE

Point any OpenAI client (or 9router: provider "OpenAI Compatible") at
  http://127.0.0.1:${config.port}/v1  with any non-empty API key.`);
}

if (cmd === "help") {
  usage();
} else if (cmd === "login") {
  const tokens = await loginFlow();
  const entry = store.set({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
  });
  console.log(`  Signed in (${store.siteKey()}). Access token stored, expires ${new Date(entry.expiresAt).toISOString()}.`);
  console.log(`  Store: ${store.storePath()}`);
} else if (cmd === "logout") {
  store.clear();
  console.log(`  Tokens cleared for ${store.siteKey()} (${store.storePath()}).`);
} else if (cmd === "status") {
  const entry = store.get();
  if (!entry?.accessToken) {
    console.log(`  Not signed in for ${store.siteKey()}. Run \`minimaxcode2api login\`.`);
    process.exitCode = 1;
  } else {
    console.log(`  site      ${store.siteKey()}`);
    console.log(`  store     ${store.storePath()}`);
    console.log(`  expires   ${entry.expiresAt ? new Date(entry.expiresAt).toISOString() : "unknown"}`);
    try {
      const alive = await upstream.probe();
      console.log(`  probe     ${alive ? "ok (upstream answered)" : "no"}`);
    } catch (err) {
      console.log(`  probe     failed: ${err.message}`);
      process.exitCode = 1;
    }
  }
} else if (cmd === "models") {
  const live = await upstream.fetchModels().catch(() => null);
  const list = live?.length ? live : KNOWN_MODELS;
  console.log(`  ${live?.length ? "live" : "static (not signed in)"} catalog, ${list.length} models:`);
  for (const m of list) console.log(`   - ${m.id}${m.name && m.name !== m.id ? `  (${m.name})` : ""}`);
} else if (cmd === "serve") {
  const { serve } = await import("../src/server.js");
  const { url } = await serve();
  const entry = store.get();
  console.log(`  minimaxcode2api listening on ${url}`);
  console.log(`  site: ${store.siteKey()}${entry?.accessToken ? "" : "  (not signed in — run `login` first)"}`);
  console.log(`  OpenAI base URL: ${url}/v1   (key: ${config.apiKey || "<any value>"})`);
  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
