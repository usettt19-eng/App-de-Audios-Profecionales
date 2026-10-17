import { test } from "node:test";
import assert from "node:assert/strict";
import { listTextModels, streamChat, textModelKey } from "../server/scriptWriter";

const sse = (texts: string[]) =>
  new Response(texts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n");

test("los modelos groq: van a Groq con su clave, sin prefijo, sin tope fijo ni plugin web", async () => {
  process.env.GROQ_API_KEY = "gk";
  let sent: any;
  const fakeFetch = (async (url: string, init: any) => {
    sent = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
    return sse(["Hola ", "mundo"]);
  }) as typeof fetch;
  let out = "";
  for await (const t of await streamChat({ apiKey: "or-key", fetch: fakeFetch }, { model: "groq:openai/gpt-oss-120b", prompt: "p", webSearch: true })) out += t;
  assert.equal(out, "Hola mundo");
  assert.equal(sent.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(sent.auth, "Bearer gk");
  assert.equal(sent.body.model, "openai/gpt-oss-120b");
  assert.equal(sent.body.max_tokens, undefined);
  assert.equal(sent.body.plugins, undefined);

  await streamChat({ apiKey: "or-key", baseUrl: "https://or.test/api/v1", fetch: fakeFetch }, { model: "anthropic/claude-sonnet-5", prompt: "p", webSearch: true });
  assert.equal(sent.url, "https://or.test/api/v1/chat/completions");
  assert.equal(sent.auth, "Bearer or-key");
  assert.deepEqual(sent.body.plugins, [{ id: "web", max_results: 8 }]);
});

test("errores legibles con el nombre del proveedor y aviso de saldo agotado", async () => {
  const fail = (async () => new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 })) as typeof fetch;
  await assert.rejects(streamChat({ apiKey: "k", fetch: fail }, { model: "x/y", prompt: "p" }), /OpenRouter \(402\): sin saldo/);
  await assert.rejects(streamChat({ apiKey: "k", fetch: fail }, { model: "groq:llama", prompt: "p" }), /Groq \(402\)/);
});

test("pide la clave que corresponde a cada proveedor", () => {
  delete process.env.GROQ_API_KEY;
  assert.deepEqual(textModelKey("groq:llama"), { error: "Falta la variable de entorno GROQ_API_KEY." });
  process.env.GROQ_API_KEY = "gk";
  assert.deepEqual(textModelKey("groq:llama"), { apiKey: "gk" });
});

test("añade los modelos de texto de Groq a la lista y omite los de voz y moderación", async () => {
  process.env.GROQ_API_KEY = "gk";
  const fakeFetch = (async (url: string) => {
    if (url.includes("groq")) {
      return Response.json({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }, { id: "canopylabs/orpheus-v1-english" }, { id: "meta-llama/llama-guard-4-12b" }, { id: "openai/gpt-oss-120b" }] });
    }
    return Response.json({ data: [{ id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" }, { id: "z/other", name: "Other" }] });
  }) as typeof fetch;
  const ids = (await listTextModels(fakeFetch, "https://or.test/api/v1")).map((m) => m.id);
  assert.deepEqual(ids, ["anthropic/claude-sonnet-5", "groq:llama-3.3-70b-versatile", "groq:openai/gpt-oss-120b", "z/other"]);
});
