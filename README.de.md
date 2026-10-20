<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Inoffizielle Brücke, die ein **MiniMax Code**-Konto (mcode) in eine lokale **OpenAI-kompatible API** verwandelt —
und eine **Anthropic-kompatible** auf demselben Port.

Sie meldet sich mit dem eigenen OAuth-**Device-Flow** von MiniMax Code an (öffentlicher Client `mcode-public`, PKCE S256) und
verwaltet ihre eigenen Tokens, sodass die eigene Anmeldung von `mcode` nie berührt wird und beide koexistieren können.

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> Inoffiziell und nicht mit MiniMax verbunden. Gedacht für den persönlichen/experimentellen Gebrauch mit einem Konto, das
> dir gehört. Beachte die Nutzungsbedingungen von MiniMax.

## Voraussetzungen

- Node.js **18+** (keine Abhängigkeiten — Nodes eingebautes `fetch`).
- Ein MiniMax Code-Konto (`agent.minimax.cn` für die CN-Seite, `agent.minimax.io` international).

## Schnellstart

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

Drei Wege, es auszuführen — kein Build-Schritt, keine Abhängigkeiten:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

Die Einrichtung ist ein einmaliges `login` (Device-Flow) pro Seite; alles andere ist zustandslos.

Richte dann einen beliebigen OpenAI-Client darauf aus:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

Streaming funktioniert ebenfalls (`"stream": true`, SSE), einschließlich Tool-Aufrufen.

## Befehle

| Befehl | Was er tut |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Device-Flow-Anmeldung; Tokens landen in `~/.minimaxcode2api/tokens.json` (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Startet die lokale API. `--key` erzwingt für `/v1/*` `Authorization: Bearer secret`. |
| `minimaxcode2api status` | Anmeldestatus + eine Upstream-Sonde mit 1 Token. |
| `minimaxcode2api models` | Modellkatalog (live vom Gateway, wenn angemeldet). |
| `minimaxcode2api logout` | Verwirft gespeicherte Tokens für die aktuelle Seite. |

## Endpunkte

| Route | Form | Hinweise |
| --- | --- | --- |
| `GET /v1/models` | OpenAI-Modellliste | Live-Katalog, wenn angemeldet, sonst statischer Fallback. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + SSE-Streaming, Tools/tool_calls, `system` wird zu Anthropic `system` angehoben. |
| `POST /v1/messages` | Anthropic Messages (Passthrough) | Für Claude Code und andere Anthropic-native Clients. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Lebendigkeit. |

## Einbindung in 9router

9router spricht mit dieser Brücke wie mit einem gewöhnlichen OpenAI-kompatiblen Anbieter:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: irgendetwas Nicht-Leeres (oder der Wert, den du an `--key` übergeben hast)
4. Modelle: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Dieselben drei Felder funktionieren für Cline, Continue, Cursor, Open WebUI, LiteLLM oder `OPENAI_BASE_URL`-Umgebungsvariablen.
Da die Brücke ein normaler lokaler HTTP-Dienst ist, funktioniert sie auch mit nichts anderem als `curl`.

## Konfiguration (env)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) oder `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Listen-Port. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Bind-Adresse. Halte sie auf Loopback, außer du weißt, warum nicht. |
| `MINIMAXCODE_KEY` | *(leer)* | Wenn gesetzt, erfordert `/v1/*` dieses Bearer-Token. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Pfad des Token-Speichers. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | Richten die OAuth-/Agent-Aufrufe auf einen Mirror (wird von der Testsuite verwendet). |
| `MINIMAXCODE_PROXY` | *(leer)* | Leitet jeden Nicht-Loopback-Upstream-Aufruf durch diesen Proxy. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. Optional — siehe unten. |

## Modelle

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — das Angebot hängt
von deinem MiniMax Code-Tarif ab; `/v1/models` meldet, was dein Konto tatsächlich sehen kann.

## Token-Handhabung

MiniMax **Refresh-Tokens sind einmalig verwendbar**: ein zweiter Refresh mit demselben Token schlägt fehl (`invalid_grant`).
Diese Brücke daher:

- hält pro Token nur einen Refresh in Bearbeitung (Single-Flight),
- merkt sich verbrauchte Tokens, damit ein Retry niemals zweimal verbrauchen kann,
- erneuert etwa 2 Minuten vor Ablauf und wiederholt ein 401/403 genau einmal.

Tokens liegen in `~/.minimaxcode2api/tokens.json`, pro Seite (`cn` / `global`). Dein MiniMax Code CLI-Zustand
in `~/.minimax` wird nie gelesen oder geschrieben.

## Proxy (optional)

Standardmäßig spricht die Brücke direkt mit MiniMax. Setze `MINIMAXCODE_PROXY`, und jeder Nicht-Loopback-Aufruf —
Device-Flow, Token-Refresh, Modellkatalog, Chat — verlässt das System stattdessen über diesen Proxy:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Unterstützte Formen: `socks5://`, `socks5h://` (DNS wird am Proxy aufgelöst), `socks4a://`, `http://`, `https://`,
mit optionalen `user:pass@`-Anmeldedaten. Loopback-Ziele umgehen den Proxy immer (dort lebt das Mock
der Testsuite). Tunnel sind handgeschrieben auf `node:net`/`node:tls` — nichts zu installieren, und ein Proxy-Fehler ist
fail-closed: die Anfrage schlägt fehl, statt still auf eine direkte Verbindung zurückzufallen.

## Repo-Layout

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

Führt die gesamte Pipeline gegen ein **Mock-MiniMax-Gateway** aus — kein Konto, kein Netzwerk. Es prüft die
Upstream-Wire-Form (Bearer + `x-mavis-*`-Header, `system`-Anhebung, Tools/tool_results in beide Richtungen),
Anthropic JSON → OpenAI-Completion und Anthropic SSE → OpenAI-Chunk-Stream (Text-Deltas, Tool-Call-
Argumente, `[DONE]`).

Verifiziert gegen ein Live-MiniMax-Code-Konto: Anmeldung über den Device-Flow, `MiniMax-M3`-Chat-
Completions (JSON + SSE) und der Anthropic-Passthrough antworteten alle mit HTTP 200 durch die Brücke.

## Einschränkungen

- Streaming-Antworten enthalten keinen `usage`-Block (das Upstream-SSE trägt Zähler nicht so,
  wie OpenAI-Clients es erwarten); Nicht-Streaming-Antworten tun es.
- Bildteile werden als Anthropic-`image`-Blöcke weitergeleitet (`base64`-Daten-URLs oder einfache URLs).
- Fehler vom Gateway (Kontingent, Region, Auth) werden mit ihrem Upstream-Status durchgereicht; eine Kontingent-
  Ablehnung wird wörtlich weitergegeben, damit ein Upstream-Router ein Failover durchführen kann.

## Lizenz

MIT — siehe [LICENSE](LICENSE).