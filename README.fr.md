<div align="center">

**English** · [Türkçe](README.tr.md) · [中文](README.cn.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

</div>

# minimaxcode2api

Passerelle non officielle qui transforme un compte **MiniMax Code** (mcode) en une **API locale compatible OpenAI** —
et une **compatible Anthropic** sur le même port.

Elle se connecte avec le **device flow** OAuth propre à MiniMax Code (client public `mcode-public`, PKCE S256) et
conserve ses propres jetons, de sorte que la connexion de `mcode` n'est jamais touchée et que les deux peuvent coexister.

```
Client OpenAI / 9router  ──►  minimaxcode2api (local)  ──►  agent.minimax[.cn|.io] passerelle MiniMax Code
```

> Non officielle et sans affiliation avec MiniMax. Destinée à un usage personnel/expérimental avec un compte que vous
> possédez. Respectez les conditions d'utilisation de MiniMax.

## Prérequis

- Node.js **18+** (aucune dépendance — le `fetch` intégré de Node).
- Un compte MiniMax Code (`agent.minimax.cn` pour le site CN, `agent.minimax.io` pour l'international).

## Démarrage rapide

```bash
# depuis ce dépôt
node bin/minimaxcode2api.js login --site cn     # affiche un code + une URL, approuvez-le dans le navigateur
node bin/minimaxcode2api.js serve --port 8788   # démarre l'API locale
```

Trois façons de l'exécuter — aucune étape de build, aucune dépendance :

```bash
npx minimaxcode2api serve                     # une fois publié : directement depuis npm
npm install -g minimaxcode2api && minimaxcode2api serve
git clone <this repo> && cd minimaxcode2api && node bin/minimaxcode2api.js serve
```

La configuration se fait via un `login` unique (device flow) par site ; tout le reste est sans état.

Pointez ensuite n'importe quel client OpenAI vers elle :

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"merhaba"}]}'
```

Le streaming fonctionne aussi (`"stream": true`, SSE), y compris les appels d'outils.

## Commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `minimaxcode2api login [--site cn\|global]` | Connexion par device flow ; les jetons sont enregistrés dans `~/.minimaxcode2api/tokens.json` (chmod 600). |
| `minimaxcode2api serve [--port 8788] [--key secret]` | Démarre l'API locale. `--key` fait que `/v1/*` exige `Authorization: Bearer secret`. |
| `minimaxcode2api status` | État de connexion + une sonde amont de 1 jeton. |
| `minimaxcode2api models` | Catalogue de modèles (en direct depuis la passerelle lorsque connecté). |
| `minimaxcode2api logout` | Supprime les jetons enregistrés pour le site actuel. |

## Points de terminaison

| Route | Forme | Remarques |
| --- | --- | --- |
| `GET /v1/models` | Liste de modèles OpenAI | Catalogue en direct lorsque connecté, repli statique sinon. |
| `POST /v1/chat/completions` | OpenAI Chat Completions | JSON + streaming SSE, tools/tool_calls, system remonté vers le `system` d'Anthropic. |
| `POST /v1/messages` | Anthropic Messages (passthrough) | Pour Claude Code et les autres clients natifs Anthropic. |
| `GET /healthz` | `{ ok, site, signedIn, expiresAt }` | Vivacité. |

## Intégration dans 9router

9router parle à cette passerelle comme à un simple fournisseur compatible OpenAI :

1. Providers → add → **OpenAI Compatible**
2. Base URL : `http://127.0.0.1:8788/v1`
3. Clé API : n'importe quoi de non vide (ou la valeur passée à `--key`)
4. Modèles : `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`

Les trois mêmes champs fonctionnent pour Cline, Continue, Cursor, Open WebUI, LiteLLM, ou les variables d'environnement `OPENAI_BASE_URL`.
Comme la passerelle est un service HTTP local normal, elle fonctionne aussi avec rien d'autre que `curl`.

## Configuration (env)

| Variable | Défaut | Signification |
| --- | --- | --- |
| `MINIMAXCODE_SITE` | `cn` | `cn` (account.minimax.cn) ou `global` (account.minimax.io). |
| `MINIMAXCODE_PORT` | `8788` | Port d'écoute. |
| `MINIMAXCODE_HOST` | `127.0.0.1` | Adresse de liaison. Gardez-la en loopback sauf si vous savez pourquoi vous ne le faites pas. |
| `MINIMAXCODE_KEY` | *(vide)* | Lorsqu'elle est définie, `/v1/*` exige ce jeton bearer. |
| `MINIMAXCODE_STORE` | `~/.minimaxcode2api/tokens.json` | Chemin du stockage des jetons. |
| `MINIMAXCODE_ACCOUNT_BASE` / `MINIMAXCODE_AGENT_BASE` | — | Pointe les appels OAuth/agent vers un miroir (utilisé par la suite de tests). |
| `MINIMAXCODE_PROXY` | *(vide)* | Achemine chaque appel amont non-loopback via ce proxy. `socks5://`, `socks5h://`, `http://`, `https://`, `user:pass@host:port`. Facultatif — voir ci-dessous. |

## Modèles

`MiniMax-M3.1-Flash-Preview`, `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` — l'offre dépend
de votre forfait MiniMax Code ; `/v1/models` indique ce que votre compte peut réellement voir.

## Gestion des jetons

Les **jetons de rafraîchissement** de MiniMax **sont à usage unique** : un second rafraîchissement avec le même jeton échoue (`invalid_grant`).
Cette passerelle donc :

- ne garde qu'un seul rafraîchissement en vol par jeton (single-flight),
- mémorise les jetons dépensés pour qu'une nouvelle tentative ne puisse jamais en brûler deux fois,
- rafraîchit environ 2 minutes avant l'expiration, et réessaie un 401/403 exactement une fois.

Les jetons résident dans `~/.minimaxcode2api/tokens.json`, par site (`cn` / `global`). L'état de votre CLI MiniMax Code
dans `~/.minimax` n'est jamais lu ni écrit.

## Proxy (facultatif)

Par défaut, la passerelle parle directement à MiniMax. Définissez `MINIMAXCODE_PROXY` et chaque appel non-loopback —
device flow, rafraîchissement de jeton, catalogue de modèles, chat — sort par ce proxy à la place :

```bash
MINIMAXCODE_PROXY=socks5h://127.0.0.1:40000 minimaxcode2api serve
```

Formes prises en charge : `socks5://`, `socks5h://` (DNS résolu au niveau du proxy), `socks4a://`, `http://`, `https://`,
avec identifiants `user:pass@` facultatifs. Les cibles loopback contournent toujours le proxy (le mock de la suite de tests
s'y trouve). Les tunnels sont faits main sur `node:net`/`node:tls` — rien à installer, et une défaillance du proxy est
fail-closed : la requête échoue au lieu de retomber silencieusement sur une connexion directe.

## Arborescence du dépôt

```
bin/minimaxcode2api.js   Point d'entrée CLI (login / serve / status / models / logout)
src/config.js            sites, points de terminaison, catalogue de modèles statique, défauts d'env
src/oauth.js             device flow MiniMax Code (PKCE S256) + rafraîchissement
src/store.js             stockage des jetons (~/.minimaxcode2api/tokens.json) + discipline de rafraîchissement à usage unique
src/upstream.js          appels à la passerelle mavis (Bearers + en-têtes x-mavis-*, un réessai de rafraîchissement sur 401)
src/translate.js         traduction requête/réponse OpenAI <-> Anthropic (JSON + SSE)
src/server.js            façade HTTP : /healthz, /v1/models, /v1/chat/completions, /v1/messages
src/http.js              une couche de requête : fetch natif, ou le tunnel ci-dessous lorsqu'un proxy est défini
src/proxy.js             tunnels HTTP CONNECT / SOCKS5 sans dépendance + agents
test/smoke.js            test de bout en bout contre une passerelle mock (aucun compte, aucun réseau)
```

## Tests

```bash
node test/smoke.js
```

Exécute tout le pipeline contre une **passerelle MiniMax mock** — aucun compte, aucun réseau. Il vérifie la
forme du trafic amont (Bearer + en-têtes `x-mavis-*`, remontée de `system`, tools/tool_results dans les deux sens),
Anthropic JSON → complétion OpenAI, et Anthropic SSE → flux de chunks OpenAI (deltas de texte, arguments d'appel
d'outil, `[DONE]`).

Vérifié contre un compte MiniMax Code réel : connexion via le device flow, complétions de chat `MiniMax-M3`
(JSON + SSE) et le passthrough Anthropic ont tous répondu HTTP 200 via la passerelle.

## Limites

- Les réponses en streaming n'incluent pas de bloc `usage` (le SSE amont ne transporte pas les compteurs comme
  les clients OpenAI l'attendent) ; les réponses non-streaming en incluent.
- Les parties image sont transmises en tant que blocs `image` Anthropic (URL de données `base64` ou URL simples).
- Les erreurs de la passerelle (quota, région, auth) sont transmises avec leur statut amont ; un refus de quota
  est remonté tel quel afin qu'un routeur amont puisse basculer.

## Licence

MIT — voir [LICENSE](LICENSE).

---

## ⚠️ Risque de compte et minimisation
