import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { buildImagePrompts, cleanImagePrompt, subjectForSection, thumbnailSubject } from "../src/lib/imagePrompts";
import { BUILTIN_FORMAT } from "../src/lib/formats";
import { generateImage, listImageModels, defaultImageModel } from "../server/imageEngine";

const dir = mkdtempSync(path.join(tmpdir(), "audios-images-"));
process.env.DATA_DIR = dir;
process.env.TTS_RETRY_BASE_MS = "1";
const projects = await import("../server/projects");
after(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("el tema de la imagen sale del título del bloque o de su primera frase", () => {
  assert.equal(subjectForSection("Estructura 1: El Viaducto de Millau", ""), "El Viaducto de Millau");
  assert.equal(subjectForSection("Presa Hoover", ""), "Presa Hoover");
  assert.equal(
    subjectForSection("Gancho", "NARRADOR (Intrigante): Hay un edificio en el desierto que no debería sostenerse en pie. Otra frase."),
    "Hay un edificio en el desierto que no debería sostenerse en pie"
  );
  assert.equal(subjectForSection("Cierre", "NARRADOR: Si te gustó este recorrido, suscríbete.", "Las construcciones más imposibles"), "Las construcciones más imposibles");
  assert.equal(thumbnailSubject([{ title: "Gancho", script: "" }, { title: "Presa Hoover", script: "" }, { title: "Burj Khalifa", script: "" }, { title: "Cierre", script: "" }], "X"), "Burj Khalifa");
});

test("rellena las 4 plantillas del formato y limpia los parámetros de Midjourney", () => {
  const prompts = buildImagePrompts(BUILTIN_FORMAT.visuales.variaciones, "Viaducto de Millau");
  assert.equal(prompts.length, 4);
  assert.equal(prompts[0].variation, "Establishing shot");
  assert.equal(prompts[0].prompt, "Viaducto de Millau, wide aerial drone shot at sunrise, epic scale, cinematic color grading, 8k, no text, no watermark");
  assert.match(prompts[3].prompt, /^black and white archival-style photo of Viaducto de Millau under construction/);
  for (const p of prompts) assert.doesNotMatch(p.prompt, /--ar|--style|\{elemento\}/);
  assert.equal(cleanImagePrompt("castle, no text --ar 16:9 --style raw"), "castle, no text");
});

test("pide la imagen a OpenRouter en 16:9 y lee el base64", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
  }) as unknown as typeof fetch;
  const img = await generateImage({ apiKey: "k", baseUrl: "https://x.test/api/v1", fetch: fakeFetch }, { model: "bytedance-seed/seedream-4.5", prompt: "P", resolution: "2K" });
  assert.equal(img.ext, "png");
  assert.deepEqual(img.data, PNG);
  assert.equal(calls[0].url, "https://x.test/api/v1/images");
  assert.deepEqual(calls[0].body, { model: "bytedance-seed/seedream-4.5", prompt: "P", aspect_ratio: "16:9", resolution: "2K" });
  assert.equal(calls[0].auth, "Bearer k");
});

test("acepta imágenes por enlace y muestra los errores de OpenRouter", async () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const byUrl = (async (url: string) =>
    url.endsWith("/images") ? new Response(JSON.stringify({ data: [{ url: "https://cdn.test/a.jpg" }] })) : new Response(jpg)) as unknown as typeof fetch;
  assert.equal((await generateImage({ apiKey: "k", fetch: byUrl }, { model: "m", prompt: "P" })).ext, "jpg");

  const bad = (async () => new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 })) as unknown as typeof fetch;
  await assert.rejects(generateImage({ apiKey: "k", fetch: bad }, { model: "m", prompt: "P" }), /OpenRouter \(402\): Insufficient credits/);
});

test("lista modelos de imagen con recomendados primero", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ data: [
      { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro", architecture: { output_modalities: ["image"] } },
      { id: "bytedance-seed/seedream-4.5", name: "Seedream 4.5", architecture: { output_modalities: ["image"] } },
      { id: "openai/gpt-5", name: "GPT-5", architecture: { output_modalities: ["text"] } },
    ] }))) as unknown as typeof fetch;
  const models = await listImageModels(fakeFetch, "https://x.test/api/v1");
  assert.deepEqual(models.map((m) => m.id), ["bytedance-seed/seedream-4.5", "black-forest-labs/flux.2-pro"]);
  assert.equal(defaultImageModel(models), "bytedance-seed/seedream-4.5");
});

test("crea los prompts del proyecto y el ZIP incluye imágenes y miniatura", async () => {
  const source = "[BLOQUE 1 — GANCHO]\nHay un edificio en el desierto.\n[BLOQUE 2 — VIADUCTO DE MILLAU]\nA 300 metros.\n[BLOQUE 3 — CIERRE]\nFin.";
  const created = await projects.createProject({ name: "Doc", source });
  let project = await projects.mutateProject(created.id, (p) =>
    void projects.ensureImagePrompts(p, { variaciones: BUILTIN_FORMAT.visuales.variaciones, miniatura: BUILTIN_FORMAT.miniatura })
  );
  assert.equal(project.sections[1].images?.length, 4);
  assert.match(project.sections[1].images![0].prompt, /^Viaducto de Millau, wide aerial/);
  assert.match(project.thumbnail!.prompt, /^YouTube thumbnail, Viaducto de Millau in extreme low angle/);

  const millau = project.sections[1];
  const name = projects.imageFileName({ sectionId: millau.id, n: 0 }, "png");
  await projects.saveImageFile(project.id, name, PNG);
  await projects.saveImageFile(project.id, "thumbnail.png", PNG);
  project = await projects.mutateProject(project.id, (p) => {
    Object.assign(p.sections[1].images![0], { status: "done", file: name });
    Object.assign(p.thumbnail!, { status: "done", file: "thumbnail.png" });
  });
  const zip = (await projects.buildProjectZip(project)).toString("latin1");
  assert.ok(zip.includes("imagenes/02 - Viaducto de Millau - 1 Establishing shot.png"));
  assert.ok(zip.includes("miniatura.png"));

  // Una imagen "generando" tras reiniciar el servidor se muestra como interrumpida.
  project = await projects.mutateProject(project.id, (p) => void (p.sections[0].images![0].status = "generating"));
  assert.equal(projects.toView(project).sections[0].images![0].status, "error");
  await assert.rejects(projects.readImageFile(project.id, "../project.json"));
});
