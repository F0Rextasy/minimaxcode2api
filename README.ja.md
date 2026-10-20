<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

**MiniMax Code** (mcode) アカウントをローカルの **OpenAI 互換 API** に変える非公式ブリッジ —
そして同じポートで **Anthropic 互換** の API にもなります。

MiniMax Code 自身の OAuth **デバイスフロー**（パブリッククライアント `mcode-public`、PKCE S256）でサインインし、
独自のトークンを保持するため、`mcode` 自身のログインには一切触れず、両者が共存できます。

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> 非公式であり、MiniMax とは提携していません。ご自身が所有するアカウントでの個人利用・実験利用を
> 目的としています。MiniMax の利用規約を遵守してください。

## 要件

- Node.js **18+**（依存関係なし — Node 内蔵の `fetch`）。
- MiniMax Code アカウント（CN サイトは `agent.minimax.cn`、国際版は `agent.minimax.io`）。

## クイックスタート

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

実行方法は3通り — ビルド不要、依存関係なし:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

セットアップはサイトごとに一度だけの `login`（デバイスフロー）で、それ以外はすべてステートレスです。

あとは任意の OpenAI クライアントをこれに向けるだけです:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

ストリーミング（`"stream": true`、SSE）も動作し、ツール呼び出しにも対応しています。

## コマンド

| コマンド | 動作 |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | デバイスフローでサインイン。トークンは `~/.minimaxcode2api/tokens.json` に保存されます（chmod 600）。 |
| `minimaxcode2api serve [--port 8788] [--key secret]` | ローカル API を起動します。`--key` を指定すると `/v1/*` に `Authorization: Bearer secret` が必要になります。 |
| `minimaxcode2api status` | サインイン状態 + 1トークンの上流プローブ。 |
| `minimaxcode2api models` | モデルカタログ（サインイン時はゲートウェイからライブ取得）。 |
| `minimaxcode2api logout` | 現在のサイトの保存済みトークンを削除します。 |

## エンドポイント

| ルート | 形式 | 備考 |
| --- | --- | --- |
| `GET /v1/models` | OpenAI モデル一覧 | サインイン時はライブカタログ、それ以外は静的フォールバック。 |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + SSE ストリーミング、tools/tool_calls、system は Anthropic の `system` に持ち上げ。 |
| `POST /v1/messages` | Anthropic Messages（パススルー） | Claude Code やその他の Anthropic ネイティブクライアント向け。 |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | 死活監視。 |

## 9router への組み込み

9router はこのブリッジを通常の OpenAI 互換プロバイダーとして扱います:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: 空でない任意の値（または `--key` に渡した値）
4. Models: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

同じ3つのフィールドが Cline、Continue、Cursor、Open WebUI、LiteLLM、または `OPENAI_BASE_URL` 環境変数でも機能します。
ブリッジは通常のローカル HTTP サービスなので、`curl` だけでも動作します。

## 設定（環境変数）

| 変数 | デフォルト | 意味 |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn`（account.minimax.cn）または `global`（account.minimax.io）。 |
| `MINIMAXCODE_PORT` | `8788` | リッスンポート。 |
| `MINIMAXCODE_HOST` | `127.0.0.1` | バインドアドレス。理由がない限りループバックのままにしてください。 |
| `MINIMAXCODE_KEY` | *(空)* | 設定すると `/v1/*` にこのベアラートークンが必要になります。 |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | トークンストアのパス。 |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | OAuth/エージェント呼び出しをミラーに向けます（テストスイートで使用）。 |
| `MINIMAXCODE_PROXY` | *(空)* | すべての非ループバック上流呼び出しをこのプロキシ経由にします。`socks5://`、`socks5h://`、`http://`、`https://`、`user:pass@host:port`。任意 — 下記参照。 |

## モデル

`MiniMax-M3.1-Flash-Preview`、`MiniMax-M3`、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed` — 提供内容は
MiniMax Code プランによって異なります。`/v1/models` はあなたのアカウントが実際に見られるものを報告します。

## トークンの扱い

MiniMax の **リフレッシュトークンは単回使用**です: 同じトークンで2回目のリフレッシュを行うと失敗します（`invalid_grant`）。
そのためこのブリッジは:

- トークンごとに1つのリフレッシュのみを実行中に保ち（シングルフライト）、
- 使用済みトークンを記憶し、リトライで二重に消費されることがないようにし、
- 有効期限の約2分前にリフレッシュし、401/403 に対してちょうど1回だけリトライします。

トークンは `~/.minimaxcode2api/tokens.json` にサイトごと（`cn` / `global`）に保存されます。`~/.minimax` にある
MiniMax Code CLI の状態は読み書きされません。

## プロキシ（任意）

デフォルトではブリッジは MiniMax と直接通信します。`MINIMAXCODE_PROXY` を設定すると、すべての非ループバック呼び出し —
デバイスフロー、トークンリフレッシュ、モデルカタログ、チャット — が代わりにそのプロキシ経由で出ていきます:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

対応形式: `socks5://`、`socks5h://`（DNS はプロキシ側で解決）、`socks4a://`、`http://`、`https://`、
任意で `user:pass@` 認証情報付き。ループバック宛先は常にプロキシをバイパスします（テストスイートのモックが
そこにあります）。トンネルは `node:net`/`node:tls` 上に手作りされており — インストールするものはなく、プロキシ障害時は
フェイルクローズドです: リクエストはエラーになり、黙って直接接続にフォールバックすることはありません。

## リポジトリ構成

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

## テスト

```bash
node test/smoke.js
```

**モック MiniMax ゲートウェイ**に対してパイプライン全体を実行します — アカウント不要、ネットワーク不要。上流の
ワイヤ形式（Bearer + `x-mavis-*` ヘッダー、`system` の持ち上げ、双方向の tools/tool_results）、
Anthropic JSON → OpenAI completion、Anthropic SSE → OpenAI チャンクストリーム（テキストデルタ、ツール呼び出し
引数、`[DONE]`）を検証します。

実際の MiniMax Code アカウントで検証済み: デバイスフローでのサインイン、`MiniMax-M3` チャット
completion（JSON + SSE）、Anthropic パススルーはすべてブリッジ経由で HTTP 200 を返しました。

## 制限

- ストリーミングレスポンスには `usage` ブロックが含まれません（上流の SSE は OpenAI クライアントが期待する形で
  カウンターを運びません）。非ストリーミングレスポンスには含まれます。
- 画像パーツは Anthropic の `image` ブロック（`base64` データ URL または通常の URL）として転送されます。
- ゲートウェイからのエラー（クォータ、リージョン、認証）は上流のステータスとともにそのまま渡されます。クォータ
  拒否はそのまま表面化されるため、上流のルーターがフェイルオーバーできます。

## ライセンス

MIT — [LICENSE](LICENSE) を参照。