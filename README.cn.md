<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

非官方桥接工具，可将 **MiniMax Code**（mcode）账户转换为本地 **OpenAI 兼容 API**——
并在同一端口上提供 **Anthropic 兼容**接口。

它使用 MiniMax Code 自有的 OAuth **设备流程**（公共客户端 `mcode-public`，PKCE S256）登录，并
维护自己的令牌，因此 `mcode` 自身的登录不会被触碰，两者可以共存。

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> 非官方项目，与 MiniMax 无关联。仅供在您自己拥有的账户上进行个人/实验性使用。
> 请遵守 MiniMax 的服务条款。

## 要求

- Node.js **18+**（无依赖——使用 Node 内置的 `fetch`）。
- 一个 MiniMax Code 账户（CN 站点使用 `agent.minimax.cn`，国际站点使用 `agent.minimax.io`）。

## 快速开始

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

三种运行方式——无需构建步骤，无依赖：

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

设置是每个站点一次性的 `login`（设备流程）；其余一切都是无状态的。

然后将任意 OpenAI 客户端指向它：

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

流式传输也可用（`"stream": true`，SSE），包括工具调用。

## 命令

| 命令 | 作用 |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | 设备流程登录；令牌保存到 `~/.minimaxcode2api/tokens.json`（chmod 600）。 |
| `minimaxcode2api serve [--port 8788] [--key secret]` | 启动本地 API。`--key` 使 `/v1/*` 要求 `Authorization: Bearer secret`。 |
| `minimaxcode2api status` | 登录状态 + 一次 1-token 上游探测。 |
| `minimaxcode2api models` | 模型目录（登录时从网关实时获取）。 |
| `minimaxcode2api logout` | 删除当前站点保存的令牌。 |

## 端点

| 路由 | 形态 | 说明 |
| --- | --- | --- |
| `GET /v1/models` | OpenAI 模型列表 | 登录时为实时目录，否则为静态回退。 |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + SSE 流式传输，tools/tool_calls，system 提升为 Anthropic `system`。 |
| `POST /v1/messages` | Anthropic Messages（透传） | 用于 Claude Code 及其他 Anthropic 原生客户端。 |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | 存活检查。 |

## 接入 9router

9router 将此桥接作为普通的 OpenAI 兼容提供方进行通信：

1. Providers → add → **OpenAI Compatible**
2. Base URL：`http://127.0.0.1:8788/v1`
3. API key：任意非空值（或您传给 `--key` 的值）
4. Models：`MiniMax-M3.1-Flash-Preview`、`MiniMax-M3`、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`

同样的三个字段也适用于 Cline、Continue、Cursor、Open WebUI、LiteLLM 或 `OPENAI_BASE_URL` 环境变量。
由于该桥接是普通的本地 HTTP 服务，它也可以仅用 `curl` 工作。

## 配置（环境变量）

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn`（account.minimax.cn）或 `global`（account.minimax.io）。 |
| `MINIMAXCODE_PORT` | `8788` | 监听端口。 |
| `MINIMAXCODE_HOST` | `127.0.0.1` | 绑定地址。除非您清楚原因，否则请保持为回环地址。 |
| `MINIMAXCODE_KEY` | *（空）* | 设置后，`/v1/*` 要求此 bearer 令牌。 |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | 令牌存储路径。 |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | 将 OAuth/agent 调用指向镜像（供测试套件使用）。 |
| `MINIMAXCODE_PROXY` | *（空）* | 将所有非回环上游调用通过此代理路由。`socks5://`、`socks5h://`、`http://`、`https://`、`user:pass@host:port`。可选——见下文。 |

## 模型

`MiniMax-M3.1-Flash-Preview`、`MiniMax-M3`、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed`——具体提供取决于
您的 MiniMax Code 套餐；`/v1/models` 会报告您的账户实际可见的模型。

## 令牌处理

MiniMax 的**刷新令牌是一次性的**：使用同一令牌进行第二次刷新会失败（`invalid_grant`）。
因此此桥接会：

- 每个令牌同时只进行一次刷新（单飞），
- 记住已使用的令牌，使重试绝不会消耗两次，
- 在过期前约 2 分钟刷新，并对 401/403 恰好重试一次。

令牌存放在 `~/.minimaxcode2api/tokens.json`，按站点区分（`cn` / `global`）。您在 `~/.minimax` 中的
MiniMax Code CLI 状态绝不会被读取或写入。

## 代理（可选）

默认情况下，桥接直接与 MiniMax 通信。设置 `MINIMAXCODE_PROXY` 后，所有非回环调用——
设备流程、令牌刷新、模型目录、聊天——都会改为通过该代理发出：

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

支持的形式：`socks5://`、`socks5h://`（DNS 在代理处解析）、`socks4a://`、`http://`、`https://`，
可选的 `user:pass@` 凭据。回环目标始终绕过代理（测试套件的 mock 就在那里）。隧道基于
`node:net`/`node:tls` 手工实现——无需安装任何东西，且代理失败是故障关闭的：请求会报错，
而不是静默回退到直连。

## 仓库结构

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

## 测试

```bash
node test/smoke.js
```

针对 **mock MiniMax 网关**运行整个流水线——无需账户，无需网络。它断言
上游线格式（Bearer + `x-mavis-*` 头、`system` 提升、双向的 tools/tool_results）、
Anthropic JSON → OpenAI 补全，以及 Anthropic SSE → OpenAI 分块流（文本增量、工具调用
参数、`[DONE]`）。

已针对真实的 MiniMax Code 账户验证：通过设备流程登录、`MiniMax-M3` 聊天
补全（JSON + SSE）以及 Anthropic 透传均通过桥接返回 HTTP 200。

## 限制

- 流式响应不包含 `usage` 块（上游 SSE 不像 OpenAI 客户端期望的那样携带计数器）；非流式响应则包含。
- 图像部分作为 Anthropic `image` 块转发（`base64` 数据 URL 或普通 URL）。
- 来自网关的错误（配额、地区、认证）会连同其上游状态一并透传；配额
  拒绝会原样呈现，以便上游路由器可以故障转移。

## 许可证

MIT——见 [LICENSE](LICENSE)。

---

## ⚠️ 账号风险与降低方法
