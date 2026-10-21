<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Ponte não oficial que transforma uma conta **MiniMax Code** (mcode) em uma **API local compatível com OpenAI** —
e também **compatível com Anthropic** na mesma porta.

Ele faz login com o próprio **device flow** OAuth do MiniMax Code (cliente público `mcode-public`, PKCE S256) e
mantém seus próprios tokens, então o login do próprio `mcode` nunca é tocado e ambos podem coexistir.

```
Cliente OpenAI / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] gateway MiniMax Code
```

> Não oficial e sem afiliação com a MiniMax. Destinado a uso pessoal/experimental com uma conta que você
> possui. Respeite os termos de serviço da MiniMax.

## Requisitos

- Node.js **18+** (sem dependências — `fetch` nativo do Node).
- Uma conta MiniMax Code (`agent.minimax.cn` para o site CN, `agent.minimax.io` internacional).

## Início rápido

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

Três formas de executá-lo — sem etapa de build, sem dependências:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

A configuração é um `login` único (device flow) por site; todo o resto é stateless.

Depois aponte qualquer cliente OpenAI para ele:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

Streaming também funciona (`"stream": true`, SSE), incluindo tool calls.

## Comandos

| Comando | O que faz |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Login via device flow; os tokens ficam em `~/.minimaxcode2api/tokens.json` (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Inicia a API local. `--key` faz `/v1/*` exigir `Authorization: Bearer secret`. |
| `minimaxcode2api status` | Estado do login + uma sondagem upstream de 1 token. |
| `minimaxcode2api models` | Catálogo de modelos (ao vivo do gateway quando logado). |
| `minimaxcode2api logout` | Descarta os tokens salvos do site atual. |

## Endpoints

| Rota | Formato | Observações |
| --- | --- | --- |
| `GET /v1/models` | Lista de modelos OpenAI | Catálogo ao vivo quando logado, fallback estático caso contrário. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + streaming SSE, tools/tool_calls, system elevado para `system` do Anthropic. |
| `POST /v1/messages` | Anthropic Messages (passthrough) | Para Claude Code e outros clientes nativos do Anthropic. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Liveness. |

## Integrando ao 9router

O 9router fala com esta ponte como um provedor comum compatível com OpenAI:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: qualquer valor não vazio (ou o valor que você passou para `--key`)
4. Modelos: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Os mesmos três campos funcionam para Cline, Continue, Cursor, Open WebUI, LiteLLM ou variáveis de ambiente `OPENAI_BASE_URL`.
Como a ponte é um serviço HTTP local comum, também funciona apenas com `curl`.

## Configuração (env)

| Variável | Padrão | Significado |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) ou `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Porta de escuta. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Endereço de bind. Mantenha em loopback a menos que você saiba por que não. |
| `MINIMAXCODE_KEY` | *(vazio)* | Quando definido, `/v1/*` exige este bearer token. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Caminho do armazenamento de tokens. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | Aponta as chamadas OAuth/agent para um espelho (usado pela suíte de testes). |
| `MINIMAXCODE_PROXY` | *(vazio)* | Roteia toda chamada upstream não-loopback através deste proxy. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. Opcional — veja abaixo. |

## Modelos

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — a oferta depende
do seu plano MiniMax Code; `/v1/models` informa o que sua conta realmente consegue ver.

## Tratamento de tokens

Os **refresh tokens** da MiniMax **são de uso único**: um segundo refresh com o mesmo token falha (`invalid_grant`).
Esta ponte, portanto:

- mantém um refresh em andamento por token (single-flight),
- lembra tokens já gastos para que uma retentativa nunca os queime duas vezes,
- renova ~2 minutos antes da expiração, e retenta um 401/403 exatamente uma vez.

Os tokens ficam em `~/.minimaxcode2api/tokens.json`, por site (`cn` / `global`). O estado do seu CLI MiniMax Code
em `~/.minimax` nunca é lido nem escrito.

## Proxy (opcional)

Por padrão a ponte fala diretamente com a MiniMax. Defina `MINIMAXCODE_PROXY` e toda chamada não-loopback —
device flow, refresh de token, catálogo de modelos, chat — sai através desse proxy:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Formas suportadas: `socks5://`, `socks5h://` (DNS resolvido no proxy), `socks4a://`, `http://`, `https://`,
com credenciais opcionais `user:pass@`. Alvos loopback sempre ignoram o proxy (o mock da suíte de testes
fica lá). Os túneis são feitos à mão sobre `node:net`/`node:tls` — nada para instalar, e uma falha de proxy é
fail-closed: a requisição dá erro em vez de cair silenciosamente para uma conexão direta.

## Estrutura do repositório

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

## Testes

```bash
node test/smoke.js
```

Executa todo o pipeline contra um **gateway MiniMax mock** — sem conta, sem rede. Ele verifica o
formato do wire upstream (Bearer + headers `x-mavis-*`, elevação de `system`, tools/tool_results em ambas as direções),
Anthropic JSON → completion OpenAI, e Anthropic SSE → stream de chunks OpenAI (deltas de texto, argumentos
de tool-call, `[DONE]`).

Verificado contra uma conta MiniMax Code real: login através do device flow, chat completions com
`MiniMax-M3` (JSON + SSE) e o passthrough Anthropic, todos responderam HTTP 200 através da ponte.

## Limitações

- Respostas em streaming não incluem um bloco `usage` (o SSE upstream não carrega contadores do jeito que
  clientes OpenAI esperam); respostas não-streaming incluem.
- Partes de imagem são encaminhadas como blocos `image` do Anthropic (data URLs `base64` ou URLs simples).
- Erros do gateway (cota, região, auth) são repassados com seu status upstream; uma recusa por cota
  é exposta literalmente para que um roteador upstream possa fazer failover.

## Licença

MIT — veja [LICENSE](LICENSE).

---

## ⚠️ Risco de conta e como minimizar
