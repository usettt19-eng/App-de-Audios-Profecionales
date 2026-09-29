import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  analysisBody, BUILTIN_FORMAT, buildAnalysisPrompt, buildProcessPrompt, DEFAULT_ANALYSIS_PROMPT, formatToMarkdown, parseNiches, parseProcess,
} from "../src/lib/formats";
import { channelDataToText, fetchChannelData, isoDurationToSeconds, parseChannelRef } from "../server/youtube";

const dir = mkdtempSync(path.join(tmpdir(), "audios-formats-"));
process.env.DATA_DIR = path.join(dir, "projects");
const research = await import("../server/research");
after(() => rmSync(dir, { recursive: true, force: true }));

const ANALYSIS = `## Formato que funciona
Compilación countdown con gancho superlativo.

## 3 nichos con hueco
1. Puentes extremos...

\`\`\`json
{"formato": "countdown superlativo", "nichos": [{"nombre": "Puentes extremos", "por_que": "poca competencia"}, {"nombre": "Túneles", "por_que": "curiosidad"}, {"nombre": "Presas", "por_que": "datos impactantes"}]}
\`\`\``;

test("el prompt de análisis lleva el canal, los datos y las reglas de respuesta", () => {
  const withData = buildAnalysisPrompt(DEFAULT_ANALYSIS_PROMPT, "@iCuriosiviajes", "Canal: Curiosiviajes");
  assert.ok(withData.startsWith(DEFAULT_ANALYSIS_PROMPT));
  assert.match(withData, /Canal o idea a analizar: @iCuriosiviajes/);
  assert.match(withData, /DATOS DEL CANAL[\s\S]*Canal: Curiosiviajes/);
  assert.match(withData, /```json/);
  assert.match(buildAnalysisPrompt(DEFAULT_ANALYSIS_PROMPT, "misterio"), /investiga en la web/);
});

test("extrae los 3 nichos y separa el análisis del JSON", () => {
  assert.deepEqual(parseNiches(ANALYSIS), [
    { nombre: "Puentes extremos", porQue: "poca competencia" },
    { nombre: "Túneles", porQue: "curiosidad" },
    { nombre: "Presas", porQue: "datos impactantes" },
  ]);
  const body = analysisBody(ANALYSIS);
  assert.match(body, /Puentes extremos\.\.\.$/);
  assert.doesNotMatch(body, /```/);
  assert.deepEqual(parseNiches("sin json"), []);
});

test("el prompt del proceso usa el análisis, el nicho y el ejemplo del documental", () => {
  const prompt = buildProcessPrompt("countdown superlativo", { nombre: "Puentes extremos", porQue: "poca competencia" }, "Curiosiviajes");
  assert.match(prompt, /NICHO ELEGIDO: Puentes extremos/);
  assert.match(prompt, /Por qué tiene hueco: poca competencia/);
  assert.match(prompt, /Canal o idea de referencia: Curiosiviajes/);
  assert.match(prompt, /LAS CONSTRUCCIONES MÁS IMPOSIBLES/);
  assert.match(prompt, /\{elemento\}/);
});

test("convierte la respuesta del modelo en un formato y completa lo que falte", () => {
  const raw = "```json\n" + JSON.stringify({
    nombre: "Puentes imposibles",
    titulo: "LOS PUENTES MÁS IMPOSIBLES | Documental 4K",
    duracion: "20-25",
    prompt_guion: "Escribe un guion sobre puentes.",
    visuales: { variaciones: [{ nombre: "Aérea", prompt: "{elemento}, aerial" }] },
  }) + "\n```";
  const f = parseProcess(raw, { nombre: "Puentes extremos", porQue: "" }, "abcdef12-0000", "Curiosiviajes");
  assert.equal(f.nombre, "Puentes imposibles");
  assert.equal(f.duracion, "20-25");
  assert.match(f.promptGuion, /\{titulo\}/, "si falta {titulo} se añade");
  assert.deepEqual(f.visuales.variaciones, [{ nombre: "Aérea", prompt: "{elemento}, aerial" }]);
  assert.equal(f.visuales.plantillaBase, BUILTIN_FORMAT.visuales.plantillaBase);
  assert.equal(f.direccionVoz, BUILTIN_FORMAT.direccionVoz);
  assert.equal(f.origen, "Curiosiviajes");
  assert.throws(() => parseProcess("no es json", { nombre: "x", porQue: "" }, "id", undefined), /formato esperado/);
});

test("exporta el formato con las 6 secciones del documento de proceso", () => {
  const md = formatToMarkdown(BUILTIN_FORMAT);
  for (const h of ["## 1. Análisis del formato base", "## 2. Guion", "## 3. Narración (TTS)", "## 4. Visuales", "## 5. Miniatura", "## 6. Checklist de producción"]) {
    assert.ok(md.includes(h), h);
  }
  assert.ok(md.includes(BUILTIN_FORMAT.promptGuion), "el prompt se exporta sin modificar");
  assert.match(md, /- \[ \] Generar miniatura/);
});

test("guarda formatos, crea el formato base y los edita", async () => {
  const list = await research.listFormats();
  // Deben quedar dentro de DATA_DIR (el volumen de Docker): fuera de él el contenedor no tiene permisos.
  const { existsSync } = await import("fs");
  assert.ok(existsSync(path.join(process.env.DATA_DIR!, "_formats", `${BUILTIN_FORMAT.id}.json`)));
  assert.deepEqual(list.map((f) => f.id), [BUILTIN_FORMAT.id]);
  const edited = await research.updateFormat(BUILTIN_FORMAT.id, { duracion: "30-35", id: "hack" } as any);
  assert.equal(edited.duracion, "30-35");
  assert.equal(edited.id, BUILTIN_FORMAT.id, "el id no se puede cambiar");
  const run = await research.saveResearch({ input: "@x", source: "web", analysis: "a", niches: [], model: "m" });
  await research.linkFormat(run.id, BUILTIN_FORMAT.id);
  assert.deepEqual((await research.getResearch(run.id)).formatIds, [BUILTIN_FORMAT.id]);
  await assert.rejects(research.getFormat("../../etc/passwd"));
});

test("reconoce enlaces y referencias de canales de YouTube", () => {
  assert.deepEqual(parseChannelRef("https://www.youtube.com/@iCuriosiviajes/videos"), { kind: "handle", value: "@iCuriosiviajes" });
  assert.deepEqual(parseChannelRef("@canal.x"), { kind: "handle", value: "@canal.x" });
  assert.deepEqual(parseChannelRef("youtube.com/channel/UC1234567890123456789012"), { kind: "id", value: "UC1234567890123456789012" });
  assert.deepEqual(parseChannelRef("https://youtube.com/user/viejo"), { kind: "username", value: "viejo" });
  assert.equal(parseChannelRef("canales de documentales de misterio"), null);
  assert.equal(isoDurationToSeconds("PT1H2M3S"), 3723);
  assert.equal(isoDurationToSeconds("PT25M"), 1500);
});

test("obtiene datos del canal con la API de YouTube", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const reply = (data: unknown) => new Response(JSON.stringify(data));
    if (u.pathname.endsWith("/channels"))
      return reply({ items: [{ id: "UCx", snippet: { title: "Curiosiviajes", customUrl: "@icuriosiviajes", description: "Viajes" }, statistics: { subscriberCount: "1500000", videoCount: "300" }, contentDetails: { relatedPlaylists: { uploads: "UUx" } } }] });
    if (u.pathname.endsWith("/playlistItems")) return reply({ items: [{ contentDetails: { videoId: "v2" } }] });
    if (u.pathname.endsWith("/search")) return reply({ items: [{ id: { videoId: "v1" } }] });
    if (u.pathname.endsWith("/videos")) {
      const id = u.searchParams.get("id");
      return reply({ items: [{ snippet: { title: id === "v1" ? "LOS PUEBLOS MÁS IMPOSIBLES" : "Nuevo", publishedAt: "2026-01-02T00:00:00Z" }, contentDetails: { duration: "PT32M10S" }, statistics: { viewCount: "2400000" } }] });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

  const data = await fetchChannelData({ kind: "handle", value: "@iCuriosiviajes" }, "KEY", fakeFetch);
  assert.ok(calls[0].includes("forHandle=%40iCuriosiviajes") && calls[0].includes("key=KEY"));
  assert.equal(data.masVistos[0].titulo, "LOS PUEBLOS MÁS IMPOSIBLES");
  const text = channelDataToText(data);
  assert.match(text, /Curiosiviajes \(@icuriosiviajes\) — 1\.5M suscriptores — 300 videos/);
  assert.match(text, /"LOS PUEBLOS MÁS IMPOSIBLES" \| 32:10 \| 2\.4M vistas \| 2026-01-02/);
});
