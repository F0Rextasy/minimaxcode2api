// End-to-end smoke test against a mock MiniMax gateway.
//
// Proves, without any MiniMax account:
//   - the bridge sends the right wire shape (Bearer + x-mavis headers)
//   - OpenAI -> Anthropic request translation (system, tools, tool results)
//   - Anthropic JSON -> OpenAI completion (text + tool_calls + usage)
//   - Anthropic SSE  -> OpenAI chunk stream (text deltas, tool args, [DONE])
//
// Run: node test/smoke.js

import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mmc2api-"));
const tokenFile = path.join(tmp, "tokens.json");
fs.writeFileSync(tokenFile, JSON.stringify({ cn: { accessToken: "test-token", refreshToken: "", expiresAt: Date.now() + 3600_000 } }));

// ── mock upstream ────────────────────────────────────────────────────────────
const seen = [];
const mock = http.createServer(async (req, res) => {
  const body = await new Promise((r) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => r(Buffer.concat(c).toString("utf8")));
  });
  seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });

  if (req.url.startsWith("/mavis/api/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ providers: [{ providerId: "minimax", config: { models: [{ model: "MiniMax-M3", display_name: "MiniMax M3" }] } }] }));
  }
  if (req.url.startsWith("/mavis/api/v1/llm/v1/messages")) {
    const wantsTools = (seen.at(-1).body?.tools || []).length > 0 && /use the tool/i.test(JSON.stringify(seen.at(-1).body));
    if (!seen.at(-1).body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(wantsTools
        ? {
            id: "msg_tool", type: "message", role: "assistant", stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Istanbul" } }],
            usage: { input_tokens: 12, output_tokens: 5 },
          }
        : {
            id: "msg_1", type: "message", role: "assistant", stop_reason: "end_turn",
            content: [{ type: "text", text: "Merhaba! Bu bir mock yanit." }],
            usage: { input_tokens: 21, output_tokens: 9 },
          }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const textStream = [
      ["message_start", { type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", content: [], usage: { input_tokens: 7, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Mer" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "haba" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const toolStream = [
      ["message_start", { type: "message_start", message: { id: "msg_3", role: "assistant", content: [] } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_2", name: "get_weather", input: {} } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Istanbul"}' } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const sse = wantsTools ? toolStream : textStream;
    for (const [event, data] of sse) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return res.end();
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end("{}");
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockPort = mock.address().port;

// ── bridge under test (same process, env-pointed at the mock) ────────────────
process.env.MINIMAXCODE_AGENT_BASE = `http://127.0.0.1:${mockPort}`;
process.env.MINIMAXCODE_ACCOUNT_BASE = `http://127.0.0.1:${mockPort}`;
process.env.MINIMAXCODE_STORE = tokenFile;
process.env.MINIMAXCODE_PORT = "0";

const { serve } = await import("../src/server.js");
const { server, url } = await serve({ port: 0 });

const post = (p, body) =>
  fetch(`${url}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// 1) models
{
  const res = await fetch(`${url}/v1/models`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.data[0].id, "MiniMax-M3");
  console.log("ok  /v1/models (live catalog from upstream)");
}

// 2) non-streaming chat + wire shape
{
  const res = await post("/v1/chat/completions", {
    model: "MiniMax-M3",
    messages: [
      { role: "system", content: "Kisa cevap ver." },
      { role: "user", content: "Selam" },
    ],
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.object, "chat.completion");
  assert.equal(data.choices[0].message.content, "Merhaba! Bu bir mock yanit.");
  assert.equal(data.choices[0].finish_reason, "stop");
  assert.equal(data.usage.prompt_tokens, 21);
  assert.equal(data.usage.completion_tokens, 9);

  const upstreamCall = seen.find((s) => s.url.includes("/messages") && !s.body.stream);
  assert.equal(upstreamCall.headers.authorization, "Bearer test-token");
  assert.equal(upstreamCall.headers["x-mavis-agent-id"], "main");
  assert.equal(upstreamCall.headers["user-agent"], "MiniMaxAgent");
  assert.equal(upstreamCall.headers["anthropic-version"], "2023-06-01");
  assert.equal(upstreamCall.body.system, "Kisa cevap ver.");
  assert.equal(upstreamCall.body.messages[0].content[0].text, "Selam");
  console.log("ok  POST /v1/chat/completions (json) + mavis headers + system lift");
}

// 3) streaming chat
{
  const res = await post("/v1/chat/completions", {
    model: "MiniMax-M3",
    stream: true,
    messages: [{ role: "user", content: "Selam" }],
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  const detail = () => `stream body: ${JSON.stringify(text.slice(0, 300))}`;
  assert.ok(text.includes('"role":"assistant"'), `role chunk — ${detail()}`);
  assert.ok(text.includes('"content":"Mer"') && text.includes('"content":"haba"'), `text deltas — ${detail()}`);
  assert.ok(text.includes('"finish_reason":"stop"'), `finish reason — ${detail()}`);
  assert.ok(text.trim().endsWith("data: [DONE]"), `DONE sentinel — ${detail()}`);
  assert.ok(text.split("\n").every((l) => !l.startsWith("data:") || (() => { try { const p = l.slice(5).trim(); return p === "[DONE]" || !!JSON.parse(p); } catch { return false; } })()), `every data: line is valid JSON — ${detail()}`);
  console.log("ok  POST /v1/chat/completions (stream) -> OpenAI chunks + [DONE]");
}

// 4) tool calling (non-stream) + tool result round-trip
{
  const res = await post("/v1/chat/completions", {
    model: "MiniMax-M3",
    messages: [
      { role: "user", content: "Use the tool" },
      { role: "assistant", content: null, tool_calls: [{ id: "toolu_0", type: "function", function: { name: "get_weather", arguments: '{"city":"Ankara"}' } }] },
      { role: "tool", tool_call_id: "toolu_0", content: "18C" },
    ],
    tools: [{ type: "function", function: { name: "get_weather", description: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
    tool_choice: "auto",
  });
  const data = await res.json();
  assert.equal(data.choices[0].finish_reason, "tool_calls");
  assert.equal(data.choices[0].message.tool_calls[0].function.name, "get_weather");
  assert.deepEqual(JSON.parse(data.choices[0].message.tool_calls[0].function.arguments), { city: "Istanbul" });

  const call = seen.at(-1);
  assert.equal(call.body.tools[0].name, "get_weather");
  assert.deepEqual(call.body.messages[1].content[0].input, { city: "Ankara" });
  assert.equal(call.body.messages[2].content[0].type, "tool_result");
  assert.equal(call.body.messages[2].content[0].tool_use_id, "toolu_0");
  console.log("ok  tools: OpenAI <-> Anthropic round-trip (tool_use + tool_result)");
}

// 5) tool calling (stream) — tool_use deltas -> OpenAI tool_calls chunks
{
  const res = await post("/v1/chat/completions", {
    model: "MiniMax-M3",
    stream: true,
    messages: [{ role: "user", content: "Use the tool" }],
    tools: [{ type: "function", function: { name: "get_weather", description: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  const chunks = text
    .split("\n")
    .filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
    .map((l) => JSON.parse(l.slice(5).trim()));
  const toolChunks = chunks.filter((c) => c.choices[0].delta.tool_calls);
  assert.ok(toolChunks.length >= 2, `expected tool_calls chunks, got ${text.slice(0, 200)}`);
  assert.equal(toolChunks[0].choices[0].delta.tool_calls[0].function.name, "get_weather");
  assert.equal(toolChunks[0].choices[0].delta.tool_calls[0].id, "toolu_2");
  const args = toolChunks.slice(1).map((c) => c.choices[0].delta.tool_calls[0].function.arguments).join("");
  assert.deepEqual(JSON.parse(args), { city: "Istanbul" });
  assert.equal(chunks.at(-1).choices[0].finish_reason, "tool_calls");
  console.log("ok  POST /v1/chat/completions (stream) -> tool_calls deltas + finish_reason");
}

server.close();
mock.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("\nAll smoke checks passed.");
