import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScriptAudio } from "../server/scriptAudio";
import { openRouterEngine } from "../server/engines/openrouter";
import { fetchOpenRouterModels } from "../server/ttsCatalog";
import { pcmToWav, wavToPcm } from "../server/audio";

process.env.TTS_RETRY_BASE_MS = "1";

// WAV de prueba: `seconds` de tono a la frecuencia y canales indicados, en 16 bits.
function toneWav(seconds: number, sampleRate: number, channels: number): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let f = 0; f < frames; f++) {
    const v = Math.round(10000 * Math.sin((2 * Math.PI * 440 * f) / sampleRate));
    for (let c = 0; c < channels; c++) data.writeInt16LE(v, (f * channels + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function mockFetch(calls: any[], respond?: (body: any, n: number) => Response) {
  return (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers });
    if (respond) return respond(body, calls.length);
    return new Response(toneWav(1, 24000, 1), { headers: { "content-type": "audio/wav" } });
  }) as unknown as typeof fetch;
}

const engines = (calls: any[], respond?: (body: any, n: number) => Response) => ({
  openrouter: openRouterEngine(() => ({ apiKey: "sk-test", baseUrl: "https://example.test/api/v1", fetch: mockFetch(calls, respond) })),
});

test("envía cada personaje por separado con su voz y la clave de OpenRouter", async () => {
  const calls: any[] = [];
  const { wav, blocks } = await generateScriptAudio(engines(calls), {
    model: "google/gemini-3.8-flash-tts",
    script: "ANA: Hola.\nMARCOS: Buenas.\nANA: Adiós.",
    voices: { ANA: "Kore", MARCOS: "Charon" },
  });
  assert.equal(blocks, 3, "OpenRouter no admite multivoz: un bloque por intervención");
  assert.deepEqual(calls.map((c) => c.body.voice), ["Kore", "Charon", "Kore"]);
  assert.equal(calls[0].url, "https://example.test/api/v1/audio/speech");
  assert.equal((calls[0].headers as any).Authorization, "Bearer sk-test");
  assert.equal(calls[0].body.response_format, "wav");
  assert.equal(calls[0].body.model, "google/gemini-3.8-flash-tts");
  // 3 s de voz + 2 respiros de 250 ms
  assert.equal((wav.length - 44) / 48000, 3.5);
});

test("con Gemini añade el estilo y las acotaciones; con otros modelos las quita", async () => {
  const direction = "Voz: masculina, tono grave de documental, español latino.\n- Velocidad: 90-95%";
  const script = "NARRADOR (intrigante): Hay un edificio (susurrando) en el desierto.";

  const gemini: any[] = [];
  await generateScriptAudio(engines(gemini), { model: "google/gemini-3.8-flash-tts", script, voices: {}, direction });
  const input: string = gemini[0].body.input;
  assert.match(input, /^Narra en español con tono documental, grave/);
  assert.match(input, /\[intrigante\] Hay un edificio \[susurrando\] en el desierto\./);
  assert.equal(gemini[0].body.voice, "Charon", "voz sugerida por el prompt");
  assert.equal(gemini[0].body.speed, 0.93);

  const kokoro: any[] = [];
  await generateScriptAudio(engines(kokoro), { model: "hexgrad/kokoro-82m", script, voices: { NARRADOR: "em_alex" }, direction });
  assert.equal(kokoro[0].body.input, "Hay un edificio en el desierto.");
  assert.equal(kokoro[0].body.voice, "em_alex");
});

test("si el modelo no acepta speed, reintenta sin él", async () => {
  const calls: any[] = [];
  await generateScriptAudio(
    engines(calls, (body) =>
      body.speed
        ? new Response(JSON.stringify({ error: { message: "Unsupported parameter: speed" } }), { status: 400 })
        : new Response(toneWav(1, 24000, 1))
    ),
    { model: "hexgrad/kokoro-82m", script: "Hola.", voices: {}, direction: "Velocidad: 90%" }
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.speed, 0.9);
  assert.equal(calls[1].body.speed, undefined);
});

test("los errores de OpenRouter llegan con su mensaje y no se reintentan si son de la solicitud", async () => {
  const calls: any[] = [];
  await assert.rejects(
    generateScriptAudio(engines(calls, () => new Response(JSON.stringify({ error: { message: "Invalid voice" } }), { status: 400 })), {
      model: "google/gemini-3.8-flash-tts",
      script: "Hola.",
      voices: {},
    }),
    /OpenRouter \(400\): Invalid voice/
  );
  assert.equal(calls.length, 1);
});

test("reintenta ante límite de cuota (429)", async () => {
  const calls: any[] = [];
  await generateScriptAudio(
    engines(calls, (_b, n) => (n === 1 ? new Response("{}", { status: 429 }) : new Response(toneWav(1, 24000, 1)))),
    { model: "google/gemini-3.8-flash-tts", script: "Hola.", voices: {} }
  );
  assert.equal(calls.length, 2);
});

test("convierte WAV de cualquier frecuencia y canales a 24 kHz mono", () => {
  const pcm = wavToPcm(toneWav(2, 48000, 2));
  assert.equal(pcm.length, 2 * 24000 * 2);
  const roundTrip = wavToPcm(pcmToWav(pcm));
  assert.equal(roundTrip.length, pcm.length);
  const peak = Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(pcm.readInt16LE(i * 2))));
  assert.ok(peak > 9000 && peak < 11000, `amplitud conservada (${peak})`);
});

test("rechaza MP3 con un mensaje claro", async () => {
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(100)]);
  await assert.rejects(
    generateScriptAudio(engines([], () => new Response(mp3)), { model: "mistralai/voxtral-mini-tts", script: "Hola.", voices: {} }),
    /solo entrega MP3/
  );
});

test("lee modelos y voces de la API de modelos de OpenRouter", async () => {
  const fakeFetch = (async (url: string) =>
    new Response(
      JSON.stringify({
        data: [
          { id: "hexgrad/kokoro-82m", name: "Kokoro 82M", architecture: { output_modalities: ["speech"] }, voices: [{ id: "em_alex", gender: "male", language: "es" }, "ef_dora"] },
          { id: "openai/gpt-5", name: "GPT-5", architecture: { output_modalities: ["text"] } },
        ],
      })
    )) as unknown as typeof fetch;
  const models = await fetchOpenRouterModels(fakeFetch, "https://example.test/api/v1");
  assert.deepEqual(models, [
    {
      id: "hexgrad/kokoro-82m",
      label: "Kokoro 82M",
      engine: "openrouter",
      voices: [{ name: "em_alex", tone: "male · es" }, { name: "ef_dora" }],
      supportsInstructions: false,
    },
  ]);
});
