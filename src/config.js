// Site table + defaults. The two MiniMax Code sites (China / international)
// share the same wire shape; only the account and agent hosts differ.
//
// Wire spec (device flow, PKCE S256, public client "mcode-public") follows the
// shape used by the mcode CLI sign-in and by 9router's minimax-code provider.

export const SITES = {
  cn: {
    account: "https://account.minimax.cn",
    agent: "https://agent.minimax.cn",
    region: "cn",
  },
  global: {
    account: "https://account.minimax.io",
    agent: "https://agent.minimax.io",
    region: "global",
  },
};

export const CLIENT_ID = "mcode-public";
export const SCOPE = "agent.default";
export const AUDIENCE = "agent-backend";
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export const AGENT_ID = "main";
export const USER_AGENT = "MiniMaxAgent";
export const ANTHROPIC_VERSION = "2023-06-01";

// Static catalog, mirroring 9router's registry. /v1/models prefers the live
// upstream catalog when a token is present and falls back to this list.
export const KNOWN_MODELS = [
  { id: "MiniMax-M3.1-Flash-Preview", name: "MiniMax M3.1 Flash Preview" },
  { id: "MiniMax-M3", name: "MiniMax M3" },
  { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
  { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
];

export const DEFAULT_MODEL = "MiniMax-M3";

export const config = {
  site: process.env.MINIMAXCODE_SITE === "global" ? "global" : "cn",
  // Overrides exist for tests and for pointing at a mirror/proxy.
  accountBase: process.env.MINIMAXCODE_ACCOUNT_BASE || "",
  agentBase: process.env.MINIMAXCODE_AGENT_BASE || "",
  port: Number(process.env.MINIMAXCODE_PORT || 8788),
  host: process.env.MINIMAXCODE_HOST || "127.0.0.1",
  // Optional local key. When set, /v1/* requires "Authorization: Bearer <key>".
  apiKey: process.env.MINIMAXCODE_KEY || "",
  storePath: process.env.MINIMAXCODE_STORE || "",
  region: process.env.MINIMAXCODE_REGION || "",
  // Optional upstream proxy for OUR runs (http/https CONNECT or socks5).
  // When set, every non-loopback request leaves through it; fail-closed.
  proxy: process.env.MINIMAXCODE_PROXY || "",
};

export function site() {
  const s = SITES[config.site] || SITES.cn;
  return {
    ...s,
    account: (config.accountBase || s.account).replace(/\/+$/, ""),
    agent: (config.agentBase || s.agent).replace(/\/+$/, ""),
    region: config.region || s.region,
  };
}

export function endpoints() {
  const s = site();
  return {
    deviceUrl: `${s.account}/oauth2/device/code`,
    tokenUrl: `${s.account}/oauth2/token`,
    messagesUrl: `${s.agent}/mavis/api/v1/llm/v1/messages`,
    modelsUrl: `${s.agent}/mavis/api/v1/models?region=${s.region}&buildEnv=prod`,
  };
}
