import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScriptPrompt, DEFAULT_SCRIPT_PROMPT, OUTPUT_FORMAT_RULES, wordsForDuration } from "../src/lib/scriptTemplates";
import { listTextModels, defaultTextModel, readChatStream, streamScript } from "../server/scriptWriter";
import { importTechnicalScript } from "../src/lib/technicalScript";

function sse(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Se trocea a propósito a mitad de línea para probar el búfer.
  const raw = lines.join("\n") + "\n";
  const pieces = [raw.slice(0, 17), raw.slice(17, 60), raw.slice(60)];
  return new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;

test("calcula las palabras a partir de la duración", () => {
  assert.equal(wordsForDuration("25-30"), "3,800-4,500");
  assert.equal(wordsForDuration("20"), "3,000");
  assert.equal(wordsForDuration("abc"), "");
});

test("rellena el prompt del proceso y añade las reglas de formato", () => {
  const prompt = buildScriptPrompt(DEFAULT_SCRIPT_PROMPT, { titulo: "PUENTES IMPOSIBLES", tema: "solo Asia", duracion: "25-30", segmentos: "12 a 15" });
  assert.match(prompt, /"PUENTES IMPOSIBLES"/);
  assert.match(prompt, /Indicaciones adicionales: solo Asia/);
  assert.match(prompt, /25-30 minutos de narración \(aprox\. 3,800-4,500 palabras\)/);
  assert.match(prompt, /12 a 15 estructuras/);
  assert.ok(prompt.endsWith(OUTPUT_FORMAT_RULES));
  assert.doesNotMatch(prompt, /\{(titulo|tema|duracion|palabras|segmentos)\}/);
  assert.doesNotMatch(buildScriptPrompt(DEFAULT_SCRIPT_PROMPT, { titulo: "X", duracion: "10", segmentos: "5" }), /Indicaciones adicionales/);
});

test("lee el streaming de OpenRouter, ignora comentarios y se detiene en [DONE]", async () => {
  const chunks: string[] = [];
  for await (const c of readChatStream(sse([": OPENROUTER PROCESSING", "", delta("[BLOQUE 1 — "), delta("GANCHO]\nHola"), "data: [DONE]", delta("ignorado")]))) chunks.push(c);
  assert.equal(chunks.join(""), "[BLOQUE 1 — GANCHO]\nHola");
});

test("propaga los errores que llegan dentro del streaming", async () => {
  const stream = sse([delta("Hola"), `data: ${JSON.stringify({ error: { message: "Rate limit" } })}`]);
  await assert.rejects(async () => {
    for await (const _ of readChatStream(stream)) void _;
  }, /Rate limit/);
});

test("envía el prompt al modelo elegido y devuelve errores legibles", async () => {
  const calls: any[] = [];
  const okFetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(sse([delta("texto"), "data: [DONE]"]));
  }) as unknown as typeof fetch;
  const out: string[] = [];
  for await (const c of await streamScript({ apiKey: "k", baseUrl: "https://x.test/api/v1", fetch: okFetch }, { model: "anthropic/claude-sonnet-5", prompt: "P" })) out.push(c);
  assert.equal(out.join(""), "texto");
  assert.equal(calls[0].url, "https://x.test/api/v1/chat/completions");
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.model, "anthropic/claude-sonnet-5");
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "P" }]);

  const badFetch = (async () => new Response(JSON.stringify({ error: { message: "No endpoints found" } }), { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(streamScript({ apiKey: "k", fetch: badFetch }, { model: "x/y", prompt: "P" }), /OpenRouter \(404\): No endpoints found/);
});

test("lista modelos de texto con recomendados primero y costo estimado", async () => {
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "zeta/modelo", name: "Zeta", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } },
          { id: "google/gemini-3.8-flash-tts", name: "TTS", architecture: { input_modalities: ["text"], output_modalities: ["speech"] } },
          { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, pricing: { prompt: "0.000003", completion: "0.000015" } },
        ],
      })
    )) as unknown as typeof fetch;
  const models = await listTextModels(fakeFetch, "https://x.test/api/v1");
  assert.deepEqual(models.map((m) => m.id), ["anthropic/claude-sonnet-5", "zeta/modelo"]);
  assert.equal(models[0].recommended, true);
  assert.ok(Math.abs((models[0].estimatedCost ?? 0) - 0.126) < 1e-9);
  assert.equal(defaultTextModel(models), "anthropic/claude-sonnet-5");
});

test("un guion con el formato pedido se divide en bloques con nombre", () => {
  const generated = `[BLOQUE 1 — GANCHO]
(MÚSICA: cinemático, tenso)
(Tono: Intrigante)
Hay un edificio en el desierto que no debería sostenerse en pie.
(Pausa de 1 segundos)
[BLOQUE 2 — VIADUCTO DE MILLAU]
(MÚSICA: elegante)
A 300 metros de altura, una carretera cuelga de cables de acero.
[BLOQUE 3 — CIERRE]
Cada una fue declarada imposible.`;
  const sections = importTechnicalScript(generated);
  assert.deepEqual(sections.map((s) => s.title), ["Gancho", "Viaducto de Millau", "Cierre"]);
  assert.equal(sections[0].cues[0].kind, "MÚSICA");
  assert.match(sections[0].script, /\[PAUSA 1000ms\]/);
});
