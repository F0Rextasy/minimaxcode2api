<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

**MiniMax Code**(mcode) 계정을 로컬 **OpenAI 호환 API**로 바꿔주는 비공식 브리지 —
그리고 같은 포트에서 **Anthropic 호환** API도 제공합니다.

MiniMax Code 자체의 OAuth **디바이스 플로우**(공개 클라이언트 `mcode-public`, PKCE S256)로 로그인하고
자체 토큰을 보관하므로, `mcode` 자체의 로그인은 건드리지 않으며 둘이 공존할 수 있습니다.

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> 비공식이며 MiniMax와 제휴 관계가 없습니다. 본인이 소유한 계정으로 개인적/실험적 사용을 위한 것입니다.
> MiniMax의 서비스 약관을 준수하세요.

## 요구 사항

- Node.js **18+** (의존성 없음 — Node 내장 `fetch`).
- MiniMax Code 계정 (CN 사이트는 `agent.minimax.cn`, 국제는 `agent.minimax.io`).

## 빠른 시작

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

실행 방법 세 가지 — 빌드 단계도, 의존성도 없습니다:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

설정은 사이트당 한 번의 `login`(디바이스 플로우)뿐이며, 나머지는 모두 상태를 저장하지 않습니다.

그런 다음 아무 OpenAI 클라이언트나 이쪽으로 향하게 하세요:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

스트리밍도 동작합니다(`"stream": true`, SSE), 툴 호출 포함.

## 명령어

| 명령어 | 하는 일 |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | 디바이스 플로우 로그인; 토큰은 `~/.minimaxcode2api/tokens.json`에 저장됩니다 (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | 로컬 API를 시작합니다. `--key`를 주면 `/v1/*`에 `Authorization: Bearer secret`이 필요합니다. |
| `minimaxcode2api status` | 로그인 상태 + 1-토큰 업스트림 프로브. |
| `minimaxcode2api models` | 모델 카탈로그 (로그인 시 게이트웨이에서 실시간으로). |
| `minimaxcode2api logout` | 현재 사이트의 저장된 토큰을 삭제합니다. |

## 엔드포인트

| 라우트 | 형태 | 비고 |
| --- | --- | --- |
| `GET /v1/models` | OpenAI models list | 로그인 시 실시간 카탈로그, 그렇지 않으면 정적 폴백. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + SSE 스트리밍, tools/tool_calls, system은 Anthropic `system`으로 올림. |
| `POST /v1/messages` | Anthropic Messages (passthrough) | Claude Code 및 기타 Anthropic 네이티브 클라이언트용. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | 라이브니스. |

## 9router에 연결하기

9router는 이 브리지를 평범한 OpenAI 호환 프로바이더로 취급합니다:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: 비어 있지 않은 아무 값 (또는 `--key`에 넘긴 값)
4. Models: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

같은 세 필드가 Cline, Continue, Cursor, Open WebUI, LiteLLM, 또는 `OPENAI_BASE_URL` 환경 변수에도
동작합니다. 브리지가 평범한 로컬 HTTP 서비스이므로 `curl`만으로도 동작합니다.

## 설정 (env)

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) 또는 `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | 수신 포트. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | 바인드 주소. 이유를 모른다면 루프백으로 유지하세요. |
| `MINIMAXCODE_KEY` | *(비어 있음)* | 설정하면 `/v1/*`에 이 베어러 토큰이 필요합니다. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | 토큰 저장 경로. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | OAuth/에이전트 호출을 미러로 향하게 합니다 (테스트 스위트에서 사용). |
| `MINIMAXCODE_PROXY` | *(비어 있음)* | 모든 비-루프백 업스트림 호출을 이 프록시를 통해 라우팅합니다. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. 선택 사항 — 아래 참조. |

## 모델

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — 제공되는 모델은
MiniMax Code 요금제에 따라 다릅니다; `/v1/models`는 계정이 실제로 볼 수 있는 것을 보고합니다.

## 토큰 처리

MiniMax **리프레시 토큰은 일회용**입니다: 같은 토큰으로 두 번째 리프레시를 하면 실패합니다
(`invalid_grant`). 따라서 이 브리지는:

- 토큰당 하나의 리프레시만 진행 중으로 유지하고 (single-flight),
- 사용된 토큰을 기억하여 재시도가 두 번 소모되지 않게 하며,
- 만료 약 2분 전에 리프레시하고, 401/403에 정확히 한 번 재시도합니다.

토큰은 사이트별(`cn` / `global`)로 `~/.minimaxcode2api/tokens.json`에 저장됩니다. `~/.minimax`에 있는
MiniMax Code CLI 상태는 절대 읽거나 쓰지 않습니다.

## 프록시 (선택 사항)

기본적으로 브리지는 MiniMax와 직접 통신합니다. `MINIMAXCODE_PROXY`를 설정하면 모든 비-루프백 호출 —
디바이스 플로우, 토큰 리프레시, 모델 카탈로그, 채팅 — 이 대신 그 프록시를 통해 나갑니다:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

지원 형식: `socks5://`, `socks5h://` (DNS를 프록시에서 해석), `socks4a://`, `http://`, `https://`,
선택적 `user:pass@` 자격 증명. 루프백 대상은 항상 프록시를 우회합니다 (테스트 스위트의 목이 거기에
있습니다). 터널은 `node:net`/`node:tls` 위에 직접 구현되어 있습니다 — 설치할 것이 없고, 프록시 실패는
fail-closed입니다: 조용히 직접 연결로 폴백하지 않고 요청이 에러로 끝납니다.

## 저장소 구조

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

## 테스트

```bash
node test/smoke.js
```

**목 MiniMax 게이트웨이**를 상대로 전체 파이프라인을 실행합니다 — 계정도, 네트워크도 필요 없습니다.
업스트림 와이어 형태(Bearer + `x-mavis-*` 헤더, `system` 올림, 양방향 tools/tool_results),
Anthropic JSON → OpenAI completion, 그리고 Anthropic SSE → OpenAI 청크 스트림(텍스트 델타, 툴 호출
인수, `[DONE]`)을 검증합니다.

실제 MiniMax Code 계정으로 검증됨: 디바이스 플로우를 통한 로그인, `MiniMax-M3` 채팅 완성
(JSON + SSE) 및 Anthropic 패스스루가 모두 브리지를 통해 HTTP 200으로 응답했습니다.

## 제한 사항

- 스트리밍 응답에는 `usage` 블록이 포함되지 않습니다 (업스트림 SSE가 OpenAI 클라이언트가 기대하는
  방식으로 카운터를 전달하지 않습니다); 비스트리밍 응답에는 포함됩니다.
- 이미지 파트는 Anthropic `image` 블록으로 전달됩니다 (`base64` 데이터 URL 또는 일반 URL).
- 게이트웨이의 오류(할당량, 지역, 인증)는 업스트림 상태와 함께 그대로 전달됩니다; 할당량 거부는
  업스트림 라우터가 페일오버할 수 있도록 그대로 노출됩니다.

## 라이선스

MIT — [LICENSE](LICENSE) 참조.