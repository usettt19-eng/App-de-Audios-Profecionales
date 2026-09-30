import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { planMusicTracks, trackForBlock } from "../src/lib/musicPlan";
import { collectAudioStream, generateMusic, musicPrompt } from "../server/musicEngine";
import { concatArgs, mixMusicArgs, runFfmpeg, segmentArgs } from "../server/video";
import { musicSpans } from "../server/videoJob";
import { importTechnicalScript } from "../src/lib/technicalScript";

const dir = mkdtempSync(path.join(tmpdir(), "audios-music-"));
after(() => rmSync(dir, { recursive: true, force: true }));
process.env.VIDEO_NICE = "0";

const cue = (description: string) => ({ cues: [{ kind: "MÚSICA", description }] });

test("un tramo por cada indicación de música; los bloques sin indicación siguen con la anterior", () => {
  const tracks = planMusicTracks([{ cues: [] }, cue("Épica con tambores"), { cues: [{ kind: "SFX", description: "Viento" }] }, cue("Fading out"), cue("Piano íntimo")], "cinemática");
  assert.deepEqual(tracks, [
    { startIndex: 0, mood: "cinemática" },
    { startIndex: 1, mood: "Épica con tambores" },
    { startIndex: 4, mood: "Piano íntimo" },
  ]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => trackForBlock(tracks, i)), [0, 1, 1, 1, 2]);
  assert.deepEqual(planMusicTracks([cue("Tensa")], "x"), [{ startIndex: 0, mood: "Tensa" }]);
});

test("lee las indicaciones de música de un guion técnico", () => {
  const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "guion-tecnico.md"), "utf8");
  const tracks = planMusicTracks(importTechnicalScript(fixture), "cinemática");
  assert.ok(tracks.length >= 2);
  assert.equal(tracks[0].startIndex, 0);
});

test("el prompt pide música instrumental sin voces", () => {
  const prompt = musicPrompt("Épica con tambores", "Venezuela");
  assert.match(prompt, /Épica con tambores/);
  assert.match(prompt, /No vocals/);
});

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(text);
  // Se parte en trozos pequeños para probar líneas cortadas entre lecturas.
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
}

test("junta los fragmentos de audio del flujo de chat", async () => {
  const a = Buffer.from("RIFFabcd"), b = Buffer.from("WAVEdata");
  const body = sse([
    { choices: [{ delta: { content: "ok" } }] },
    { choices: [{ delta: { audio: { data: a.toString("base64") } } }] },
    { choices: [{ delta: { audio: { data: b.toString("base64") } } }] },
  ]);
  assert.deepEqual(await collectAudioStream(body), Buffer.concat([a, b]));
  await assert.rejects(collectAudioStream(sse([{ error: { message: "sin créditos" } }])), /sin créditos/);
});

test("pide la música a OpenRouter con salida de audio y envuelve PCM en WAV", async () => {
  let sent: any;
  const pcm = Buffer.alloc(4800 * 4, 1);
  const fakeFetch = (async (url: string, init: any) => {
    sent = { url, body: JSON.parse(init.body) };
    return new Response(sse([{ choices: [{ delta: { audio: { data: pcm.toString("base64") } } }] }]), { status: 200 });
  }) as typeof fetch;
  const music = await generateMusic({ apiKey: "k", baseUrl: "http://x", fetch: fakeFetch }, { model: "google/lyria-3-pro-preview", prompt: "calm" });
  assert.equal(sent.url, "http://x/chat/completions");
  assert.deepEqual(sent.body.modalities, ["text", "audio"]);
  assert.equal(sent.body.stream, true);
  assert.equal(music.ext, "wav");
  assert.equal(music.data.toString("ascii", 0, 4), "RIFF");
  assert.equal(music.data.readUInt32LE(24), 48000);

  const mp3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0]);
  const mp3Fetch = (async () => new Response(sse([{ choices: [{ delta: { audio: { data: mp3.toString("base64") } } }] }]))) as typeof fetch;
  assert.equal((await generateMusic({ apiKey: "k", fetch: mp3Fetch }, { model: "m", prompt: "p" })).ext, "mp3");

  const badFetch = (async () => new Response(JSON.stringify({ error: { message: "modelo no disponible" } }), { status: 400 })) as typeof fetch;
  await assert.rejects(generateMusic({ apiKey: "k", fetch: badFetch }, { model: "m", prompt: "p" }), /modelo no disponible/);
});

test("reparte los tramos listos por bloques y une bloques seguidos con la misma pista", () => {
  const track = (startIndex: number, file?: string) => ({ startIndex, prompt: "p", status: (file ? "done" : "pending") as any, file });
  const project: any = { music: { enabled: true, volume: 0.2, tracks: [track(0, "music-0.wav"), track(2), track(3, "music-2.mp3")] } };
  assert.deepEqual(musicSpans(project, [10, 5, 7, 3, 4], (f) => `/p/${f}`), [
    { file: "/p/music-0.wav", durationSec: 22 },
    { file: "/p/music-2.mp3", durationSec: 7 },
  ]);
  // Si el primer tramo no está listo, suena el primero disponible.
  const firstMissing: any = { music: { enabled: true, volume: 0.2, tracks: [track(0), track(1, "music-1.wav")] } };
  assert.deepEqual(musicSpans(firstMissing, [4, 6], (f) => f), [{ file: "music-1.wav", durationSec: 10 }]);
  assert.deepEqual(musicSpans({ ...project, music: { ...project.music, enabled: false } }, [1], (f) => f), []);
  assert.deepEqual(musicSpans({ music: { enabled: true, volume: 0.2, tracks: [track(0)] } } as any, [1], (f) => f), []);
});

test("la mezcla repite cada tramo, lo funde y lo baja cuando habla el narrador", () => {
  const args = mixMusicArgs("v.mp4", [{ file: "a.wav", durationSec: 30 }, { file: "b.mp3", durationSec: 12 }], 0.2, "o.mp4");
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.equal((graph.match(/aloop/g) ?? []).length, 2);
  assert.match(graph, /atrim=0:30\.000/);
  assert.match(graph, /concat=n=2:v=0:a=1,volume=0\.200/);
  assert.match(graph, /sidechaincompress/);
  assert.match(graph, /amix=inputs=2:duration=first/);
  assert.ok(args.includes("copy"), "el video no se vuelve a codificar");
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("mezcla la música en un video real sin cambiar su duración", { skip: !hasFfmpeg && "ffmpeg no instalado" }, async () => {
  const f = (n: string) => path.join(dir, n);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360", "-frames:v", "1", f("a.png")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=3", "-ar", "24000", "-ac", "1", f("n.wav")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=f=220:d=1.5", "-ar", "48000", "-ac", "2", f("m1.wav")]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=f=330:d=2", "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", f("m2.mp3")]);
  await runFfmpeg(segmentArgs({ images: [f("a.png")], audio: f("n.wav"), durationSec: 3, output: f("s1.mp4") }));
  await runFfmpeg(segmentArgs({ images: [f("a.png")], audio: f("n.wav"), durationSec: 3, output: f("s2.mp4") }));
  writeFileSync(f("list.txt"), `file '${f("s1.mp4")}'\nfile '${f("s2.mp4")}'\n`);
  await runFfmpeg(concatArgs(f("list.txt"), f("v.mp4")));
  await runFfmpeg(mixMusicArgs(f("v.mp4"), [{ file: f("m1.wav"), durationSec: 3 }, { file: f("m2.mp3"), durationSec: 3 }], 0.2, f("out.mp4")));
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,channels:format=duration", "-of", "json", f("out.mp4")]).toString());
  const audio = info.streams.find((s: any) => s.codec_type === "audio");
  assert.equal(audio.codec_name, "aac");
  assert.equal(audio.channels, 2);
  assert.ok(info.streams.some((s: any) => s.codec_type === "video"));
  assert.ok(Math.abs(Number(info.format.duration) - 6) < 0.2, `duración ${info.format.duration}`);
});
