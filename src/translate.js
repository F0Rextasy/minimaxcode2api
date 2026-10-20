// OpenAI <-> Anthropic translation for the MiniMax Code upstream.
//
// Upstream speaks the Anthropic Messages shape (streaming and not), so:
//   - requests:  OpenAI chat.completions  ->  Anthropic messages
//   - responses: Anthropic JSON/SSE       ->  OpenAI completion / chunk stream

const asText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
      .map((p) => p.text || "")
      .join("");
  }
  if (content == null) return "";
  return String(content);
};

function partsToBlocks(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: String(content ?? "") }];
  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" || typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text ?? "" });
    } else if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url;
      const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (m) blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
      else blocks.push({ type: "image", source: { type: "url", url } });
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

/** OpenAI chat.completions body -> Anthropic messages body. */
export function toAnthropic(body) {
  const systemParts = [];
  const messages = [];

  for (const msg of body.messages || []) {
    const role = msg?.role;
    if (role === "system" || role === "developer") {
      const t = asText(msg.content);
      if (t) systemParts.push(t);
      continue;
    }
    if (role === "tool" || role === "function") {
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id || msg.name || "tool",
          content: asText(msg.content),
        }],
      });
      continue;
    }
    if (role === "assistant") {
      const blocks = [];
      const t = asText(msg.content);
      if (t) blocks.push({ type: "text", text: t });
      for (const call of msg.tool_calls || []) {
        let input = {};
        try {
          input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          input = { _raw: call.function?.arguments ?? "" };
        }
        blocks.push({ type: "tool_use", id: call.id || `toolu_${Math.random().toString(36).slice(2, 10)}`, name: call.function?.name || "tool", input });
      }
      if (blocks.length) messages.push({ role: "assistant", content: blocks });
      continue;
    }
    messages.push({ role: "user", content: partsToBlocks(msg.content) });
  }

  const out = {
    model: body.model,
    max_tokens: body.max_tokens || body.max_completion_tokens || 8192,
    messages,
  };
  if (systemParts.length) out.system = systemParts.join("\n\n");
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number") out.top_p = body.top_p;
  if (body.stop) out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (body.stream) out.stream = true;

  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools
      .filter((t) => t?.type === "function" && t.function?.name)
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || undefined,
        input_schema: t.function.parameters || { type: "object", properties: {} },
      }));
    const tc = body.tool_choice;
    if (tc === "auto" || tc === undefined) out.tool_choice = { type: "auto" };
    else if (tc === "required") out.tool_choice = { type: "any" };
    else if (tc === "none") out.tool_choice = { type: "none" };
    else if (tc?.type === "function" && tc.function?.name) out.tool_choice = { type: "tool", name: tc.function.name };
  }

  return out;
}

const STOP_REASON = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

/** Anthropic message JSON -> OpenAI completion JSON. */
export function toOpenAI(json, model) {
  const text = (json.content || [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text || "")
    .join("");
  const toolCalls = (json.content || [])
    .filter((b) => b?.type === "tool_use")
    .map((b, i) => ({
      index: i,
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  const usage = json.usage || {};
  return {
    id: json.id || `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model || json.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length ? "tool_calls" : STOP_REASON[json.stop_reason] || "stop",
    }],
    usage: {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    },
  };
}

/** Anthropic SSE -> OpenAI SSE chunk stream. Writes into an async iterator of strings. */
export async function* anthropicStreamToOpenAI(lines, model) {
  const id = `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  let sentRole = false;
  let toolIndex = -1;
  let finish = null;

  for await (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    const type = evt.type;

    // Canonical Anthropic wire shape is {"type":"message_start","message":{...}};
    // some gateways relay the bare message object instead, so accept both.
    if (type === "message_start" || type === "message") {
      if (!sentRole) {
        yield chunk({ role: "assistant", content: "" });
        sentRole = true;
      }
      continue;
    }
    if (type === "content_block_start") {
      const block = evt.content_block || {};
      if (block.type === "tool_use") {
        toolIndex += 1;
        yield chunk({
          tool_calls: [{
            index: toolIndex,
            id: block.id || `toolu_${toolIndex}`,
            type: "function",
            function: { name: block.name || "tool", arguments: "" },
          }],
        });
      }
      continue;
    }
    if (type === "content_block_delta") {
      const d = evt.delta || {};
      if (d.type === "text_delta" && d.text) yield chunk({ content: d.text });
      else if (d.type === "input_json_delta" && d.partial_json) {
        yield chunk({ tool_calls: [{ index: toolIndex, function: { arguments: d.partial_json } }] });
      }
      continue;
    }
    if (type === "message_delta") {
      const reason = evt.delta?.stop_reason;
      if (reason) finish = STOP_REASON[reason] || "stop";
      continue;
    }
    if (type === "message_stop") break;
  }

  yield chunk({}, finish || "stop");
}
