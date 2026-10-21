<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Bir **MiniMax Code** (mcode) hesabını yerel bir **OpenAI uyumlu API**'ye dönüştüren resmî olmayan köprü —
ve aynı port üzerinde **Anthropic uyumlu** bir API.

MiniMax Code'un kendi OAuth **device flow**'u ile oturum açar (genel istemci `mcode-public`, PKCE S256) ve
kendi token'larını saklar, böylece `mcode`'un kendi oturumu hiç dokunulmaz ve ikisi bir arada var olabilir.

```
OpenAI client / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] MiniMax Code gateway
```

> Resmî olmayan ve MiniMax ile bağlantılı değildir. Sahibi olduğunuz bir hesapla kişisel/deneysel kullanım
> için tasarlanmıştır. MiniMax'in hizmet şartlarına uyun.

## Gereksinimler

- Node.js **18+** (bağımlılık yok — Node'un yerleşik `fetch`'i).
- Bir MiniMax Code hesabı (CN sitesi için `agent.minimax.cn`, uluslararası için `agent.minimax.io`).

## Hızlı başlangıç

```bash
# from this repo
node bin/minimaxcode2api.js login --site cn     # prints a code + URL, approve it in the browser
node bin/minimaxcode2api.js serve --port 8788   # start the local API
```

Çalıştırmanın üç yolu — derleme adımı yok, bağımlılık yok:

```bash
npx minimaxcode2api serve                     # once published: straight from npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

Kurulum, site başına bir kerelik `login` (device flow) işlemidir; geri kalan her şey durumsuzdur.

Ardından herhangi bir OpenAI istemcisini buna yönlendirin:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

Akış (streaming) da çalışır (`"stream": true`, SSE), araç çağrıları dahil.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Device-flow oturum açma; token'lar `~/.minimaxcode2api/tokens.json` içine kaydedilir (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Yerel API'yi başlatır. `--key`, `/v1/*` için `Authorization: Bearer secret` gerektirir. |
| `minimaxcode2api status` | Oturum durumu + 1 token'lık upstream yoklaması. |
| `minimaxcode2api models` | Model kataloğu (oturum açıldığında gateway'den canlı). |
| `minimaxcode2api logout` | Geçerli site için kayıtlı token'ları siler. |

## Uç noktalar

| Rota | Şekil | Notlar |
| --- | --- | --- |
| `GET /v1/models` | OpenAI models list | Oturum açıldığında canlı katalog, aksi halde statik yedek. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + SSE akışı, tools/tool_calls, system Anthropic `system`'e taşınır. |
| `POST /v1/messages` | Anthropic Messages (passthrough) | Claude Code ve diğer Anthropic-native istemciler için. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Canlılık. |

## 9router'a bağlama

9router bu köprüyle düz bir OpenAI uyumlu sağlayıcı olarak konuşur:

1. Providers → add → **OpenAI Compatible**
2. Base URL: `http://127.0.0.1:8788/v1`
3. API key: boş olmayan herhangi bir şey (veya `--key`'e verdiğiniz değer)
4. Modeller: `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Aynı üç alan Cline, Continue, Cursor, Open WebUI, LiteLLM veya `OPENAI_BASE_URL` ortam değişkenleri için de çalışır.
Köprü normal bir yerel HTTP servisi olduğundan, yalnızca `curl` ile de çalışır.

## Yapılandırma (env)

| Değişken | Varsayılan | Anlamı |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) veya `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Dinleme portu. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Bağlanma adresi. Nedenini bilmiyorsanız loopback'te tutun. |
| `MINIMAXCODE_KEY` | *(boş)* | Ayarlandığında, `/v1/*` bu bearer token'ı gerektirir. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Token deposu yolu. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | OAuth/agent çağrılarını bir aynaya yönlendirir (test paketi tarafından kullanılır). |
| `MINIMAXCODE_PROXY` | *(boş)* | Loopback olmayan her upstream çağrısını bu proxy üzerinden yönlendirir. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. İsteğe bağlı — aşağıya bakın. |

## Modeller

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — sunulan seçenekler
MiniMax Code planınıza bağlıdır; `/v1/models` hesabınızın gerçekte görebildiklerini bildirir.

## Token işleme

MiniMax **refresh token'ları tek kullanımlıktır**: aynı token ile ikinci bir yenileme başarısız olur (`invalid_grant`).
Bu nedenle bu köprü:

- token başına tek bir yenilemeyi uçuşta tutar (single-flight),
- harcanmış token'ları hatırlar, böylece bir yeniden deneme asla iki kez yakamaz,
- süresi dolmadan ~2 dakika önce yeniler ve 401/403'ü tam olarak bir kez yeniden dener.

Token'lar `~/.minimaxcode2api/tokens.json` içinde, site başına (`cn` / `global`) yaşar. `~/.minimax` içindeki
MiniMax Code CLI durumunuz asla okunmaz veya yazılmaz.

## Proxy (isteğe bağlı)

Varsayılan olarak köprü MiniMax ile doğrudan konuşur. `MINIMAXCODE_PROXY` ayarlandığında, loopback olmayan
her çağrı — device flow, token yenileme, model kataloğu, sohbet — bunun yerine o proxy üzerinden çıkar:

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Desteklenen biçimler: `socks5://`, `socks5h://` (DNS proxy'de çözülür), `socks4a://`, `http://`, `https://`,
isteğe bağlı `user:pass@` kimlik bilgileriyle. Loopback hedefleri her zaman proxy'yi atlar (test paketinin mock'u
orada yaşar). Tüneller `node:net`/`node:tls` üzerinde elle yazılmıştır — kurulacak bir şey yok ve bir proxy hatası
fail-closed'dır: istek sessizce doğrudan bağlantıya düşmek yerine hata verir.

## Depo düzeni

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

## Testler

```bash
node test/smoke.js
```

Tüm hattı bir **mock MiniMax gateway**'e karşı çalıştırır — hesap yok, ağ yok. Upstream tel biçimini
(Bearer + `x-mavis-*` başlıkları, `system` taşıma, her iki yönde tools/tool_results), Anthropic JSON → OpenAI
completion ve Anthropic SSE → OpenAI chunk akışını (metin deltaları, tool-call argümanları, `[DONE]`) doğrular.

Canlı bir MiniMax Code hesabına karşı doğrulandı: device flow ile oturum açma, `MiniMax-M3` sohbet
tamamlamaları (JSON + SSE) ve Anthropic passthrough, köprü üzerinden hepsi HTTP 200 yanıtladı.

## Sınırlar

- Akış yanıtları bir `usage` bloğu içermez (upstream SSE, OpenAI istemcilerinin beklediği şekilde sayaç
  taşımaz); akış olmayan yanıtlar içerir.
- Görsel parçaları Anthropic `image` blokları olarak iletilir (`base64` data URL'leri veya düz URL'ler).
- Gateway'den gelen hatalar (kota, bölge, kimlik doğrulama) upstream durumlarıyla birlikte iletilir; bir kota
  reddi kelimesi kelimesine yüzeye çıkarılır, böylece bir upstream yönlendirici failover yapabilir.

## Lisans

MIT — bkz. [LICENSE](LICENSE).

---

## ⚠️ Hesap riski ve riski en aza indirme
