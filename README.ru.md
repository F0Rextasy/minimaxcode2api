<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Неофициальный мост, превращающий аккаунт **MiniMax Code** (mcode) в локальный **API, совместимый с OpenAI** —
и в **совместимый с Anthropic** на том же порту.

Он выполняет вход через собственный OAuth **device flow** MiniMax Code (публичный клиент `mcode-public`, PKCE S256) и
хранит собственные токены, поэтому собственный вход `mcode` никогда не затрагивается, и оба могут сосуществовать.

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> Неофициальный проект, не связанный с MiniMax. Предназначен для личного/экспериментального использования с аккаунтом, которым вы
> владеете. Соблюдайте условия обслуживания MiniMax.

## Требования

- Node.js **18+** (без зависимостей — встроенный в Node `fetch`).
- Аккаунт MiniMax Code (`agent.minimax.cn` для сайта CN, `agent.minimax.io` для международного).

## Быстрый старт

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

Три способа запустить — без этапа сборки, без зависимостей:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

Настройка — это однократный `login` (device flow) для каждого сайта; всё остальное не хранит состояние.

Затем направьте на него любой клиент OpenAI:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

Потоковая передача тоже работает (`"stream": true`, SSE), включая вызовы инструментов.

## Команды

| Команда | Что делает |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Вход через device flow; токены сохраняются в `~/.minimaxcode2api/tokens.json` (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Запускает локальный API. `--key` заставляет `/v1/*` требовать `Authorization: Bearer secret`. |
| `minimaxcode2api status` | Состояние входа + проверка вышестоящего сервиса на 1 токен. |
| `minimaxcode2api models` | Каталог моделей (в реальном времени из шлюза, когда выполнен вход). |
| `minimaxcode2api logout` | Удаляет сохранённые токены для текущего сайта. |

## Конечные точки

| Маршрут | Форма | Примечания |
| --- | --- | --- |
| `GET /v1/models` | Список моделей OpenAI | Живой каталог при выполненном входе, иначе статический запасной вариант. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + потоковая передача SSE, tools/tool_calls, system поднимается в Anthropic `system`. |
| `POST /v1/messages` | Anthropic Messages (сквозной) | Для Claude Code и других нативных клиентов Anthropic. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Проверка работоспособности. |

## Подключение к 9router

9router общается с этим мостом как с обычным провайдером, совместимым с OpenAI:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: любое непустое значение (или значение, переданное в `--key`)
4. Models: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Те же три поля работают для Cline, Continue, Cursor, Open WebUI, LiteLLM или переменных окружения `OPENAI_BASE_URL`.
Поскольку мост — это обычная локальная HTTP-служба, он также работает с одним лишь `curl`.

## Конфигурация (env)

| Переменная | По умолчанию | Значение |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) или `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Порт прослушивания. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Адрес привязки. Оставляйте loopback, если только вы не знаете, почему нет. |
| `MINIMAXCODE_KEY` | *(пусто)* | Если задано, `/v1/*` требует этот bearer-токен. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Путь к хранилищу токенов. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | Направляют вызовы OAuth/agent на зеркало (используется набором тестов). |
| `MINIMAXCODE_PROXY` | *(пусто)* | Направляет каждый вызов вышестоящего сервиса, кроме loopback, через этот прокси. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. Необязательно — см. ниже. |

## Модели

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — предложение зависит
от вашего тарифа MiniMax Code; `/v1/models` сообщает то, что ваш аккаунт действительно может видеть.

## Обработка токенов

**Refresh-токены MiniMax одноразовые**: повторный refresh с тем же токеном завершается ошибкой (`invalid_grant`).
Поэтому этот мост:

- держит один refresh в полёте на токен (single-flight),
- запоминает использованные токены, чтобы повторная попытка никогда не сожгла токен дважды,
- обновляет примерно за 2 минуты до истечения и повторяет 401/403 ровно один раз.

Токены хранятся в `~/.minimaxcode2api/tokens.json`, по сайтам (`cn` / `global`). Состояние вашего CLI MiniMax Code
в `~/.minimax` никогда не читается и не записывается.

## Прокси (необязательно)

По умолчанию мост общается с MiniMax напрямую. Задайте `MINIMAXCODE_PROXY`, и каждый вызов, кроме loopback, —
device flow, обновление токена, каталог моделей, чат — будет выходить через этот прокси:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Поддерживаемые формы: `socks5://`, `socks5h://` (DNS разрешается на прокси), `socks4a://`, `http://`, `https://`,
с необязательными учётными данными `user:pass@`. Цели loopback всегда обходят прокси (там живёт мок
набора тестов). Туннели реализованы вручную на `node:net`/`node:tls` — ничего устанавливать не нужно, а сбой прокси
приводит к отказу: запрос завершается ошибкой вместо молчаливого отката к прямому соединению.

## Структура репозитория

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

## Тесты

```bash
node test/smoke.js
```

Прогоняет весь конвейер против **мок-шлюза MiniMax** — без аккаунта, без сети. Он проверяет
форму данных вышестоящего сервиса (Bearer + заголовки `x-mavis-*`, подъём `system`, tools/tool_results в обоих направлениях),
Anthropic JSON → завершение OpenAI и Anthropic SSE → поток чанков OpenAI (текстовые дельты, аргументы
вызова инструментов, `[DONE]`).

Проверено на живом аккаунте MiniMax Code: вход через device flow, чат-завершения `MiniMax-M3`
(JSON + SSE) и сквозной Anthropic — все ответили HTTP 200 через мост.

## Ограничения

- Потоковые ответы не включают блок `usage` (вышестоящий SSE не несёт счётчики так, как
  ожидают клиенты OpenAI); не-потоковые ответы включают.
- Части изображений пересылаются как блоки Anthropic `image` (data URL в `base64` или обычные URL).
- Ошибки от шлюза (квота, регион, аутентификация) передаются с их вышестоящим статусом; отказ по квоте
  передаётся дословно, чтобы вышестоящий маршрутизатор мог выполнить переключение при сбое.

## Лицензия

MIT — см. [LICENSE](LICENSE).

---

## ⚠️ Риск блокировки и как его снизить
