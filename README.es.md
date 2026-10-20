<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Puente no oficial que convierte una cuenta de **MiniMax Code** (mcode) en una **API local compatible con OpenAI** —
y también una **compatible con Anthropic** en el mismo puerto.

Inicia sesión con el propio **flujo de dispositivo** OAuth de MiniMax Code (cliente público `mcode-public`, PKCE S256) y
mantiene sus propios tokens, por lo que el inicio de sesión propio de `mcode` nunca se toca y ambos pueden coexistir.

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> No oficial y sin afiliación con MiniMax. Pensado para uso personal/experimental con una cuenta que
> te pertenezca. Respeta los términos de servicio de MiniMax.

## Requisitos

- Node.js **18+** (sin dependencias — el `fetch` integrado de Node).
- Una cuenta de MiniMax Code (`agent.minimax.cn` para el sitio CN, `agent.minimax.io` internacional).

## Inicio rápido

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

Tres formas de ejecutarlo — sin paso de compilación, sin dependencias:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

La configuración es un `login` único (flujo de dispositivo) por sitio; todo lo demás es sin estado.

Luego apunta cualquier cliente de OpenAI hacia él:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

El streaming también funciona (`"stream": true`, SSE), incluidas las llamadas a herramientas.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Inicio de sesión por flujo de dispositivo; los tokens se guardan en `~/.minimaxcode2api/tokens.json` (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Inicia la API local. `--key` hace que `/v1/*` requiera `Authorization: Bearer secret`. |
| `minimaxcode2api status` | Estado de inicio de sesión + una sonda upstream de 1 token. |
| `minimaxcode2api models` | Catálogo de modelos (en vivo desde la puerta de enlace cuando hay sesión iniciada). |
| `minimaxcode2api logout` | Elimina los tokens guardados del sitio actual. |

## Endpoints

| Ruta | Forma | Notas |
| --- | --- | --- |
| `GET /v1/models` | Lista de modelos de OpenAI | Catálogo en vivo cuando hay sesión iniciada, respaldo estático en caso contrario. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + streaming SSE, tools/tool_calls, system elevado a `system` de Anthropic. |
| `POST /v1/messages` | Anthropic Messages (passthrough) | Para Claude Code y otros clientes nativos de Anthropic. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Comprobación de vida. |

## Integrarlo en 9router

9router habla con este puente como un proveedor compatible con OpenAI normal:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: cualquier valor no vacío (o el valor que pasaste a `--key`)
4. Modelos: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Los mismos tres campos funcionan para Cline, Continue, Cursor, Open WebUI, LiteLLM o las variables de entorno `OPENAI_BASE_URL`.
Como el puente es un servicio HTTP local normal, también funciona con nada más que `curl`.

## Configuración (env)

| Variable | Predeterminado | Significado |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) o `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Puerto de escucha. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Dirección de enlace. Mantenlo en loopback a menos que sepas por qué no hacerlo. |
| `MINIMAXCODE_KEY` | *(vacío)* | Cuando se establece, `/v1/*` requiere este token bearer. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Ruta del almacén de tokens. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | Apunta las llamadas de OAuth/agente a un espejo (usado por la suite de pruebas). |
| `MINIMAXCODE_PROXY` | *(vacío)* | Enruta cada llamada upstream que no sea loopback a través de este proxy. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. Opcional — ver abajo. |

## Modelos

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — la oferta depende
de tu plan de MiniMax Code; `/v1/models` informa lo que tu cuenta puede ver realmente.

## Manejo de tokens

Los **refresh tokens de MiniMax son de un solo uso**: un segundo refresh con el mismo token falla (`invalid_grant`).
Por lo tanto, este puente:

- mantiene un refresh en vuelo por token (single-flight),
- recuerda los tokens gastados para que un reintento nunca pueda quemarlo dos veces,
- refresca ~2 minutos antes de la expiración, y reintenta un 401/403 exactamente una vez.

Los tokens viven en `~/.minimaxcode2api/tokens.json`, por sitio (`cn` / `global`). El estado de tu CLI de MiniMax Code
en `~/.minimax` nunca se lee ni se escribe.

## Proxy (opcional)

Por defecto el puente habla directamente con MiniMax. Establece `MINIMAXCODE_PROXY` y cada llamada que no sea loopback —
flujo de dispositivo, refresh de token, catálogo de modelos, chat — sale a través de ese proxy en su lugar:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Formas admitidas: `socks5://`, `socks5h://` (DNS resuelto en el proxy), `socks4a://`, `http://`, `https://`,
con credenciales `user:pass@` opcionales. Los destinos loopback siempre omiten el proxy (el mock de la suite de pruebas
vive ahí). Los túneles están hechos a mano sobre `node:net`/`node:tls` — nada que instalar, y un fallo del proxy es
fail-closed: la solicitud da error en lugar de recurrir silenciosamente a una conexión directa.

## Estructura del repositorio

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

## Pruebas

```bash
node test/smoke.js
```

Ejecuta todo el pipeline contra una **puerta de enlace MiniMax simulada** — sin cuenta, sin red. Verifica la
forma del cable upstream (Bearer + cabeceras `x-mavis-*`, elevación de `system`, tools/tool_results en ambas direcciones),
Anthropic JSON → finalización de OpenAI, y Anthropic SSE → flujo de chunks de OpenAI (deltas de texto, argumentos de
llamadas a herramientas, `[DONE]`).

Verificado contra una cuenta real de MiniMax Code: inicio de sesión mediante el flujo de dispositivo, finalizaciones de chat
`MiniMax-M3` (JSON + SSE) y el passthrough de Anthropic, todo respondió HTTP 200 a través del puente.

## Limitaciones

- Las respuestas en streaming no incluyen un bloque `usage` (el SSE upstream no lleva contadores de la forma en que
  los clientes de OpenAI esperan); las respuestas sin streaming sí.
- Las partes de imagen se reenvían como bloques `image` de Anthropic (URLs de datos `base64` o URLs simples).
- Los errores de la puerta de enlace (cuota, región, autenticación) se pasan con su estado upstream; una denegación
  por cuota se muestra textualmente para que un enrutador upstream pueda hacer failover.

## Licencia

MIT — ver [LICENSE](LICENSE).