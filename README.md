<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Unofficial bridge that turns a **MiniMax Code** (mcode) account into a local **OpenAI-compatible API** —
and an **Anthropic-compatible** one on the same port.

It signs in with MiniMax Code's own OAuth **device flow** (public client `mcode-public`, PKCE S256) and
keeps its own tokens, so `mcode`'s own login is never touched and both can coexist.

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> Unofficial and not affiliated with MiniMax. Intended for personal/experimental use with an account you
> own. Respect MiniMax's terms of service.

## Requirements

- Node.js **18+** (no dependencies — Node's built-in `fetch`).
- A MiniMax Code account (`agent.minimax.cn` for the CN site, `agent.minimax.io` international).

## Quick start

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

Three ways to run it — no build step, no dependencies:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

Setup is a one-time `login` (device flow) per site; everything else is stateless.

Then point any OpenAI client at it:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

Streaming works too (`"stream": true`, SSE), including tool calls.

## Commands

| Command | What it does |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Device-flow sign-in; tokens land in `~/.minimaxcode2api/tokens.json` (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Start the local API. `--key` makes `/v1/*` require `Authorization: Bearer secret`. |
| `minimaxcode2api status` | Sign-in state + a 1-token upstream probe. |
| `minimaxcode2api models` | Model catalog (live from the gateway when signed in). |
| `minimaxcode2api logout` | Drop saved tokens for the current site. |

## Endpoints

| Route | Shape | Notes |
| --- | --- | --- |
| `GET /v1/models` | OpenAI models list | Live catalog when signed in, static fallback otherwise. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + SSE streaming, tools/tool_calls, system lifted to Anthropic `system`. |
| `POST /v1/messages` | Anthropic Messages (passthrough) | For Claude Code and other Anthropic-native clients. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Liveness. |

## Wiring it into 9router

9router talks to this bridge as a plain OpenAI-compatible provider:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: anything non-empty (or the value you passed to `--key`)
4. Models: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Same three fields work for Cline, Continue, Cursor, Open WebUI, LiteLLM, or `OPENAI_BASE_URL` env vars.
Because the bridge is a normal local HTTP service, it also works with nothing but `curl`.

## Configuration (env)

| Variable | Default | Meaning |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) or `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Listen port. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Bind address. Keep it loopback unless you know why you are not. |
| `MINIMAXCODE_KEY` | *(empty)* | When set, `/v1/*` requires this bearer token. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Token store path. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | Point the OAuth/agent calls at a mirror (used by the test suite). |
| `MINIMAXCODE_PROXY` | *(empty)* | Route every non-loopback upstream call through this proxy. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. Optional — see below. |

## Models

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — the offer depends
on your MiniMax Code plan; `/v1/models` reports what your account can actually see.

## Token handling

MiniMax **refresh tokens are single-use**: a second refresh with the same token fails (`invalid_grant`).
This bridge therefore:

- keeps one refresh in flight per token (single-flight),
- remembers spent tokens so a retry can never burn twice,
- refreshes ~2 minutes before expiry, and retries a 401/403 exactly once.

Tokens live in `~/.minimaxcode2api/tokens.json`, per site (`cn` / `global`). Your MiniMax Code CLI state
in `~/.minimax` is never read or written.

## Proxy (optional)

By default the bridge talks to MiniMax directly. Set `MINIMAXCODE_PROXY` and every non-loopback call —
device flow, token refresh, model catalog, chat — leaves through that proxy instead:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Supported forms: `socks5://`, `socks5h://` (DNS resolved at the proxy), `socks4a://`, `http://`, `https://`,
with optional `user:pass@` credentials. Loopback targets always bypass the proxy (the test suite's mock
lives there). Tunnels are hand-rolled on `node:net`/`node:tls` — nothing to install, and a proxy failure is
fail-closed: the request errors out instead of silently falling back to a direct connection.

## Repo layout

```
bin/minimaxcode2api.js   CLI entry point (login / serve / status / models / logout)
src/config.js            sites, endpoints, static model catalog, env defaults
src/oauth.js             MiniMax Code device flow (PKCE S256) + refresh
src/store.js             token store (~/.minimaxcode2api/tokens.json) + single-use refresh discipline
src/upstream.js          mavis gateway calls (Bearers + x-mavis-* headers, one refresh-retry on 401)
src/translate.js         OpenAI <-> Anthropic request/response translation (JSON + SSE)
src/server.js            HTTP facade: /healthz, /v1/models, /v1/chat/completions, /v1/messages
src/http.js              one request layer: native fetch, or the tunnel below when a proxy is set
src/proxy.js             dependency-free HTTP CONNECT / SOCKS5 tunnels + agents
test/smoke.js            end-to-end test against a mock gateway (no account, no network)
```

## Tests

```bash
node test/smoke.js
```

Runs the whole pipeline against a **mock MiniMax gateway** — no account, no network. It asserts the
upstream wire shape (Bearer + `x-mavis-*` headers, `system` lift, tools/tool_results in both directions),
Anthropic JSON → OpenAI completion, and Anthropic SSE → OpenAI chunk stream (text deltas, tool-call
arguments, `[DONE]`).

Verified against a live MiniMax Code account: sign-in through the device flow, `MiniMax-M3` chat
completions (JSON + SSE) and the Anthropic passthrough all answered HTTP 200 through the bridge.

## Limits

- Streaming responses do not include a `usage` block (the upstream SSE does not carry counters the way
  OpenAI clients expect); non-streaming responses do.
- Image parts are forwarded as Anthropic `image` blocks (`base64` data URLs or plain URLs).
- Errors from the gateway (quota, region, auth) are passed through with their upstream status; a quota
  refusal is surfaced verbatim so an upstream router can fail over.

## License

MIT — see [LICENSE](LICENSE).
