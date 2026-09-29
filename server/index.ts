import express from "express";
import path from "path";
import { timingSafeEqual } from "crypto";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { defaultModel, EngineRegistry, generateScriptAudio, MAX_SCRIPT_CHARS } from "./scriptAudio";
import { geminiEngine } from "./engines/gemini";
import { openRouterEngine } from "./engines/openrouter";
import { availableModels } from "./ttsCatalog";
import { defaultTextModel, FALLBACK_TEXT_MODEL, listTextModels, streamScript } from "./scriptWriter";
import { buildScriptPrompt } from "../src/lib/scriptTemplates";
import { streamChat } from "./scriptWriter";
import { channelDataToText, fetchChannelData, parseChannelRef } from "./youtube";
import {
  deleteFormat, deleteResearch, getFormat, getResearch, linkFormat, listFormats, listResearch, newFormatId, saveFormat, saveResearch, updateFormat,
} from "./research";
import { analysisBody, buildAnalysisPrompt, buildProcessPrompt, formatToMarkdown, Niche, parseNiches, parseProcess } from "../src/lib/formats";
import { pcmDurationSeconds } from "./audio";
import { defaultImageModel, FALLBACK_IMAGE_MODEL, generateImage, listImageModels } from "./imageEngine";
import { MAX_DIRECTION_CHARS } from "../src/lib/voiceDirection";
import {
  buildProjectZip,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  MAX_SOURCE_CHARS,
  NotFoundError,
  renderFingerprint,
  safeFileName,
  saveSectionAudio,
  sectionFileName,
  toView,
  updateProject,
  updateSection,
  readSectionAudio,
  ensureImagePrompts,
  IMAGE_TYPES,
  imageFileName,
  mutateProject,
  ProjectImage,
  readImageFile,
  saveImageFile,
} from "./projects";
import { BUILTIN_FORMAT } from "../src/lib/formats";
import { buildDirectionPrompt, narrationOf, parseDirection } from "../src/lib/imageDirection";

dotenv.config();

let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta la variable de entorno GEMINI_API_KEY.");
    // GEMINI_BASE_URL permite pasar por un proxy o apuntar a un servidor de pruebas.
    const baseUrl = process.env.GEMINI_BASE_URL;
    ai = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  }
  return ai;
}

// Motores de voz disponibles según las claves configuradas (se leen en cada uso, después de dotenv).
const engines: EngineRegistry = {
  gemini: geminiEngine(getGeminiClient),
  openrouter: openRouterEngine(() => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("Falta la variable de entorno OPENROUTER_API_KEY.");
    return { apiKey, baseUrl: process.env.OPENROUTER_BASE_URL || undefined };
  }),
};

const cleanModel = (model: unknown) => (typeof model === "string" && model.trim() ? model.trim().slice(0, 200) : undefined);

const app = express();

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Con APP_PASSWORD definida, toda la app (menos /api/health) exige usuario y contraseña (HTTP Basic).
app.use((req, res, next) => {
  const password = process.env.APP_PASSWORD;
  if (!password || req.path === "/api/health") return next();
  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  const [user, ...rest] = Buffer.from(encoded || "", "base64").toString("utf8").split(":");
  if (scheme === "Basic" && safeEqual(user, process.env.APP_USER || "admin") && safeEqual(rest.join(":"), password)) return next();
  res.set("WWW-Authenticate", 'Basic realm="Audios Profesionales", charset="UTF-8"').status(401).send("Acceso restringido.");
});

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/tts/models", async (_req, res) => {
  try {
    res.json({
      defaultModel: defaultModel(),
      configured: { openrouter: !!process.env.OPENROUTER_API_KEY, gemini: !!process.env.GEMINI_API_KEY },
      models: await availableModels(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "No se pudo obtener la lista de modelos." });
  }
});

// --- Guiones con IA (modelos de texto de OpenRouter) ---

app.get("/api/text-models", async (_req, res) => {
  try {
    const models = await listTextModels(fetch, process.env.OPENROUTER_BASE_URL || undefined);
    res.json({ defaultModel: defaultTextModel(models), models });
  } catch (error: any) {
    // Sin lista en vivo, se ofrece al menos el modelo por defecto.
    const fallback = process.env.OPENROUTER_TEXT_MODEL || FALLBACK_TEXT_MODEL;
    res.json({ defaultModel: fallback, models: [{ id: fallback, name: fallback, recommended: true }], warning: error.message });
  }
});

// Devuelve el guion en texto plano a medida que se escribe. Si falla a mitad, el flujo termina con
// un carácter NUL seguido del mensaje de error, para que la interfaz lo distinga del guion.
app.post("/api/scripts/generate", async (req, res) => {
  const { titulo, tema, duracion, segmentos, template, model } = req.body ?? {};
  if (typeof titulo !== "string" || !titulo.trim()) return res.status(400).json({ error: "Escribe el título del documental." });
  if (typeof template !== "string" || !template.trim()) return res.status(400).json({ error: "El prompt del guion está vacío." });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(400).json({ error: "Falta la variable de entorno OPENROUTER_API_KEY." });

  const prompt = buildScriptPrompt(template.slice(0, 20000), {
    titulo: titulo.slice(0, 300),
    tema: typeof tema === "string" ? tema.slice(0, 2000) : "",
    duracion: typeof duracion === "string" && duracion.trim() ? duracion.slice(0, 20) : "25-30",
    segmentos: typeof segmentos === "string" && segmentos.trim() ? segmentos.slice(0, 20) : "12 a 15",
  });

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const chunks = await streamScript(
      { apiKey, baseUrl: process.env.OPENROUTER_BASE_URL || undefined, signal: abort.signal },
      { model: cleanModel(model) || process.env.OPENROUTER_TEXT_MODEL || FALLBACK_TEXT_MODEL, prompt }
    );
    // "X-Accel-Buffering: no" evita que Nginx acumule la respuesta y el texto aparece en vivo.
    res.set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    for await (const text of chunks) res.write(text);
    res.end();
  } catch (error: any) {
    if (abort.signal.aborted) return;
    console.error("Script Generation Error:", error);
    if (!res.headersSent) return res.status(502).json({ error: error.message || "No se pudo generar el guion." });
    res.end(`\u0000${error.message || "La generación se interrumpió."}`);
  }
});

// --- Ideas: análisis de canales → nichos → formatos de producción ---

// Envía el texto del modelo en vivo y, al terminar, un carácter NUL seguido de un JSON
// {"type":"done",...} o {"type":"error","message":...}. La interfaz separa ambas partes.
async function streamWithResult(
  req: express.Request,
  res: express.Response,
  start: (signal: AbortSignal) => Promise<AsyncGenerator<string>>,
  finish: (full: string) => Promise<Record<string, unknown>>
) {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  let full = "";
  try {
    const chunks = await start(abort.signal);
    res.set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    for await (const text of chunks) {
      full += text;
      res.write(text);
    }
    res.end(`\u0000${JSON.stringify({ type: "done", ...(await finish(full)) })}`);
  } catch (error: any) {
    if (abort.signal.aborted) return;
    console.error("Streaming Error:", error);
    if (!res.headersSent) return res.status(502).json({ error: error.message || "Error al generar." });
    res.end(`\u0000${JSON.stringify({ type: "error", message: error.message || "La generación se interrumpió." })}`);
  }
}

function openRouterKey(res: express.Response): string | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) res.status(400).json({ error: "Falta la variable de entorno OPENROUTER_API_KEY." });
  return apiKey || null;
}

app.post("/api/research/analyze", async (req, res) => {
  const { input, template, model } = req.body ?? {};
  if (typeof input !== "string" || !input.trim()) return res.status(400).json({ error: "Escribe un canal de YouTube o una idea." });
  if (typeof template !== "string" || !template.trim()) return res.status(400).json({ error: "El prompt de análisis está vacío." });
  const apiKey = openRouterKey(res);
  if (!apiKey) return;
  const textModel = cleanModel(model) || process.env.OPENROUTER_TEXT_MODEL || FALLBACK_TEXT_MODEL;

  // Con clave de YouTube y un canal reconocible se usan datos exactos; si no, el modelo busca en la web.
  let channelText: string | undefined;
  let channelName: string | undefined;
  let warning = "";
  const ref = parseChannelRef(input);
  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (ref && youtubeKey) {
    try {
      const data = await fetchChannelData(ref, youtubeKey);
      channelText = channelDataToText(data);
      channelName = data.nombre;
    } catch (error: any) {
      warning = `${error.message} Se usará la búsqueda web.`;
    }
  } else if (ref) {
    warning = "Sin YOUTUBE_API_KEY: los datos del canal se buscan en la web.";
  }
  const source = channelText ? "youtube" : "web";
  res.set({
    "X-Research-Source": source,
    "X-Research-Channel": encodeURIComponent(channelName ?? ""),
    "X-Research-Warning": encodeURIComponent(warning),
  });

  const prompt = buildAnalysisPrompt(template.slice(0, 10000), input.slice(0, 500), channelText);
  await streamWithResult(
    req,
    res,
    (signal) =>
      streamChat(
        { apiKey, baseUrl: process.env.OPENROUTER_BASE_URL || undefined, signal },
        { model: textModel, prompt, webSearch: source === "web", maxTokens: 6000, temperature: 0.7 }
      ),
    async (full) => {
      const research = await saveResearch({
        input: input.trim(),
        source,
        channelName,
        analysis: analysisBody(full),
        niches: parseNiches(full),
        model: textModel,
      });
      return { research };
    }
  );
});

app.get("/api/research", async (_req, res) => {
  try {
    res.json(await listResearch());
  } catch (error) {
    sendError(res, error, "Error al listar los análisis.");
  }
});

app.get("/api/research/:id", async (req, res) => {
  try {
    res.json(await getResearch(req.params.id));
  } catch (error) {
    sendError(res, error, "Error al leer el análisis.");
  }
});

app.delete("/api/research/:id", async (req, res) => {
  try {
    await deleteResearch(req.params.id);
    res.status(204).end();
  } catch (error) {
    sendError(res, error, "Error al eliminar el análisis.");
  }
});

app.post("/api/research/:id/process", async (req, res) => {
  let run;
  try {
    run = await getResearch(req.params.id);
  } catch (error) {
    return sendError(res, error, "Error al leer el análisis.");
  }
  const { nicheIndex, niche, model } = req.body ?? {};
  const chosen: Niche | undefined =
    niche && typeof niche.nombre === "string" && niche.nombre.trim()
      ? { nombre: niche.nombre.trim().slice(0, 300), porQue: String(niche.porQue ?? "").slice(0, 1000) }
      : run.niches[Number(nicheIndex)];
  if (!chosen) return res.status(400).json({ error: "Elige un nicho." });
  const apiKey = openRouterKey(res);
  if (!apiKey) return;
  const textModel = cleanModel(model) || run.model || process.env.OPENROUTER_TEXT_MODEL || FALLBACK_TEXT_MODEL;
  const origin = run.channelName || run.input;

  await streamWithResult(
    req,
    res,
    (signal) =>
      streamChat(
        { apiKey, baseUrl: process.env.OPENROUTER_BASE_URL || undefined, signal },
        { model: textModel, prompt: buildProcessPrompt(run.analysis, chosen, origin), maxTokens: 8000, temperature: 0.7 }
      ),
    async (full) => {
      const format = await saveFormat(parseProcess(full, chosen, newFormatId(), origin));
      await linkFormat(run.id, format.id);
      return { format };
    }
  );
});

app.get("/api/formats", async (_req, res) => {
  try {
    res.json(await listFormats());
  } catch (error) {
    sendError(res, error, "Error al listar los formatos.");
  }
});

app.get("/api/formats/:id", async (req, res) => {
  try {
    res.json(await getFormat(req.params.id));
  } catch (error) {
    sendError(res, error, "Error al leer el formato.");
  }
});

app.patch("/api/formats/:id", async (req, res) => {
  try {
    res.json(await updateFormat(req.params.id, req.body ?? {}));
  } catch (error) {
    sendError(res, error, "Error al guardar el formato.");
  }
});

app.delete("/api/formats/:id", async (req, res) => {
  try {
    await deleteFormat(req.params.id);
    res.status(204).end();
  } catch (error) {
    sendError(res, error, "Error al eliminar el formato.");
  }
});

app.get("/api/formats/:id/markdown", async (req, res) => {
  try {
    const format = await getFormat(req.params.id);
    res.set({ "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": contentDisposition(`Proceso - ${safeFileName(format.nombre)}.md`) });
    res.send(formatToMarkdown(format));
  } catch (error) {
    sendError(res, error, "Error al exportar el formato.");
  }
});

app.post("/api/script-audio", async (req, res) => {
  try {
    const { script, voices, direction, model } = req.body;
    if (typeof script !== "string" || !script.trim()) {
      return res.status(400).json({ error: "El guion está vacío." });
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      return res.status(400).json({ error: `El guion supera el máximo de ${MAX_SCRIPT_CHARS} caracteres.` });
    }

    const { wav, blocks, speakers } = await generateScriptAudio(engines, {
      script,
      model: cleanModel(model),
      voices: voices && typeof voices === "object" ? voices : {},
      direction: typeof direction === "string" ? direction.slice(0, MAX_DIRECTION_CHARS) : undefined,
    });

    res.set({
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "X-Audio-Blocks": String(blocks),
      "X-Audio-Speakers": encodeURIComponent(speakers.join(",")),
    });
    res.send(wav);
  } catch (error: any) {
    console.error("Script Audio Error:", error);
    res.status(500).json({ error: error.message || "Error al generar el audio del guion." });
  }
});

// --- Proyectos: varios audios (uno por bloque) con dirección y reparto comunes ---

const activeJobs = new Set<string>();
const jobKey = (projectId: string, sectionId: string) => `${projectId}:${sectionId}`;
const activeImageJobs = new Set<string>();
const viewOf = (project: Awaited<ReturnType<typeof getProject>>) =>
  toView(
    project,
    (sid) => activeJobs.has(jobKey(project.id, sid)),
    (key) => activeImageJobs.has(`${project.id}:${key}`)
  );

// Crea los prompts de imagen que falten con las plantillas del formato del proyecto (o el formato base).
async function withImagePrompts(project: Awaited<ReturnType<typeof getProject>>) {
  const needs = !project.thumbnail || project.sections.some((s) => !s.images?.length);
  if (!needs) return project;
  const format = project.formatId ? await getFormat(project.formatId).catch(() => BUILTIN_FORMAT) : BUILTIN_FORMAT;
  return mutateProject(project.id, (p) => void ensureImagePrompts(p, { variaciones: format.visuales.variaciones, miniatura: format.miniatura }));
}

function sendError(res: express.Response, error: any, fallback: string) {
  if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
  console.error(fallback, error);
  res.status(500).json({ error: error?.message || fallback });
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

app.get("/api/projects", async (_req, res) => {
  try {
    res.json(await listProjects());
  } catch (error) {
    sendError(res, error, "Error al listar los proyectos.");
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, source, direction, model, formatId } = req.body;
    if (typeof source !== "string" || !source.trim()) return res.status(400).json({ error: "Pega el guion del proyecto." });
    if (source.length > MAX_SOURCE_CHARS) return res.status(400).json({ error: `El guion supera el máximo de ${MAX_SOURCE_CHARS} caracteres.` });
    const project = await createProject({
      name: typeof name === "string" ? name : "",
      source,
      direction: typeof direction === "string" ? direction.slice(0, MAX_DIRECTION_CHARS) : "",
      model: cleanModel(model),
      formatId: typeof formatId === "string" && /^[0-9a-z-]{8,64}$/.test(formatId) ? formatId : undefined,
    });
    res.status(201).json(viewOf(await withImagePrompts(project)));
  } catch (error: any) {
    res.status(400).json({ error: error.message || "No se pudo crear el proyecto." });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    res.json(viewOf(await withImagePrompts(await getProject(req.params.id))));
  } catch (error) {
    sendError(res, error, "Error al leer el proyecto.");
  }
});

app.patch("/api/projects/:id", async (req, res) => {
  try {
    const { name, direction, voices, sections, model, imageModel, imagePrompts } = req.body;
    // Cambios de prompts de imagen: [{ target: "thumbnail" | "<sectionId>:<n>", prompt }]
    if (Array.isArray(imagePrompts) || typeof imageModel === "string") {
      await mutateProject(req.params.id, (p) => {
        if (typeof imageModel === "string" && imageModel.trim()) p.imageModel = imageModel.trim().slice(0, 200);
        for (const change of Array.isArray(imagePrompts) ? imagePrompts : []) {
          if (typeof change?.prompt !== "string" || typeof change?.target !== "string") continue;
          const [sid, n] = change.target.split(":");
          const img = change.target === "thumbnail" ? p.thumbnail : p.sections.find((s) => s.id === sid)?.images?.[Number(n)];
          if (img) img.prompt = change.prompt.slice(0, 3000);
        }
      });
    }
    const project = await updateProject(req.params.id, {
      name,
      direction: typeof direction === "string" ? direction.slice(0, MAX_DIRECTION_CHARS) : undefined,
      voices,
      model: cleanModel(model),
      sections: Array.isArray(sections) ? sections : undefined,
    });
    res.json(viewOf(project));
  } catch (error) {
    sendError(res, error, "Error al guardar el proyecto.");
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    await deleteProject(req.params.id);
    res.status(204).end();
  } catch (error) {
    sendError(res, error, "Error al eliminar el proyecto.");
  }
});

app.post("/api/projects/:id/sections/:sectionId/generate", async (req, res) => {
  const { id, sectionId } = req.params;
  const key = jobKey(id, sectionId);
  if (activeJobs.has(key)) return res.status(409).json({ error: "Esta sección ya se está generando." });
  activeJobs.add(key);
  try {
    const project = await updateSection(id, sectionId, (section) => {
      section.status = "generating";
      section.error = undefined;
    });
    const section = project.sections.find((s) => s.id === sectionId)!;
    const fingerprint = renderFingerprint(project, section);
    try {
      const { wav } = await generateScriptAudio(engines, {
        script: section.script,
        voices: project.voices,
        direction: project.direction,
        model: project.model,
      });
      await saveSectionAudio(id, sectionId, wav);
      const updated = await updateSection(id, sectionId, (s) => {
        s.status = "done";
        s.durationSec = Math.round(pcmDurationSeconds(wav.length - 44) * 10) / 10;
        s.renderedFrom = fingerprint;
        s.generatedAt = new Date().toISOString();
      });
      activeJobs.delete(key);
      res.json(viewOf(updated));
    } catch (error: any) {
      console.error("Section Audio Error:", error);
      const updated = await updateSection(id, sectionId, (s) => {
        s.status = "error";
        s.error = error?.message || "Error al generar el audio.";
      });
      activeJobs.delete(key);
      res.status(502).json({ error: error?.message || "Error al generar el audio.", project: viewOf(updated) });
    }
  } catch (error) {
    activeJobs.delete(key);
    sendError(res, error, "Error al generar la sección.");
  }
});

// --- Imágenes (API de imágenes de OpenRouter) ---

app.get("/api/image-models", async (_req, res) => {
  try {
    const models = await listImageModels(fetch, process.env.OPENROUTER_BASE_URL || undefined);
    res.json({ defaultModel: defaultImageModel(models), models });
  } catch (error: any) {
    const fallback = process.env.OPENROUTER_IMAGE_MODEL || FALLBACK_IMAGE_MODEL;
    res.json({ defaultModel: fallback, models: [{ id: fallback, name: fallback, recommended: true }], warning: error.message });
  }
});

type ImageTarget = { kind: "thumbnail" } | { kind: "section"; sectionId: string; n: number };

function targetKey(t: ImageTarget): string {
  return t.kind === "thumbnail" ? "thumbnail" : `${t.sectionId}:${t.n}`;
}

function findImage(project: Awaited<ReturnType<typeof getProject>>, t: ImageTarget): ProjectImage | undefined {
  if (t.kind === "thumbnail") return project.thumbnail;
  return project.sections.find((s) => s.id === t.sectionId)?.images?.[t.n];
}

// Aplica un cambio a una imagen dentro de la escritura serializada del proyecto.
function updateImage(projectId: string, t: ImageTarget, fn: (img: ProjectImage) => void) {
  return mutateProject(projectId, (p) => {
    const img = findImage(p, t);
    if (img) fn(img);
  });
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// Director de arte: un modelo de texto escribe los prompts de imagen de cada bloque a partir de su narración.
// Con force, rehace también los de imágenes ya generadas (salvo las subidas a mano) y las deja pendientes.
app.post("/api/projects/:id/images/plan", async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(400).json({ error: "Falta la variable de entorno OPENROUTER_API_KEY." });
  try {
    const project = await withImagePrompts(await getProject(req.params.id));
    const force = !!req.body?.force;
    const format = project.formatId ? await getFormat(project.formatId).catch(() => BUILTIN_FORMAT) : BUILTIN_FORMAT;
    const variations = format.visuales.variaciones;
    // Ids cortos (b1, b2…) para que el modelo no tenga que copiar identificadores largos.
    const blocks = project.sections.map((s, i) => ({ id: `b${i + 1}`, title: s.title, narration: narrationOf(s.script) }));
    const prompt = buildDirectionPrompt({
      videoTitle: project.name,
      blocks,
      variations,
      baseTemplate: format.visuales.plantillaBase,
      thumbnailTemplate: format.miniatura,
    });
    const models = await listTextModels(fetch, process.env.OPENROUTER_BASE_URL || undefined).catch(() => []);
    const textModel = defaultTextModel(models);
    let raw = "";
    const chunks = await streamChat(
      { apiKey, baseUrl: process.env.OPENROUTER_BASE_URL || undefined },
      { model: textModel, prompt, maxTokens: 12000, temperature: 0.4 }
    );
    for await (const text of chunks) raw += text;
    const directed = parseDirection(raw, variations.length);

    const updated = await mutateProject(project.id, (p) => {
      p.sections.forEach((section, i) => {
        const plan = directed.blocks[`b${i + 1}`];
        if (!plan) return;
        section.images = (section.images ?? []).map((img, n) => {
          const next = plan.prompts[n];
          if (!next || img.source === "upload") return img;
          if (img.status === "done" && !force) return img;
          return { ...img, prompt: next, status: img.status === "generating" ? img.status : "pending", error: undefined };
        });
      });
      if (directed.thumbnail && p.thumbnail && p.thumbnail.source !== "upload" && (force || p.thumbnail.status !== "done")) {
        Object.assign(p.thumbnail, { prompt: directed.thumbnail, status: "pending", error: undefined });
      }
      p.imagePlan = "ai";
    });
    res.json(viewOf(updated));
  } catch (error) {
    sendError(res, error, "Error al preparar los prompts de imagen.");
  }
});

// Genera imágenes: una concreta (sectionId + n), las pendientes de un bloque (sectionId) o la miniatura.
app.post("/api/projects/:id/images/generate", async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(400).json({ error: "Falta la variable de entorno OPENROUTER_API_KEY." });
  try {
    const project = await withImagePrompts(await getProject(req.params.id));
    const { sectionId, n, thumbnail } = req.body ?? {};
    let targets: ImageTarget[] = [];
    if (thumbnail) targets = [{ kind: "thumbnail" }];
    else {
      const section = project.sections.find((s) => s.id === sectionId);
      if (!section) return res.status(404).json({ error: "Sección no encontrada." });
      const indices = Number.isInteger(n) ? [n] : (section.images ?? []).map((img, i) => (img.status === "done" ? -1 : i)).filter((i) => i >= 0);
      targets = indices.filter((i) => section.images?.[i]).map((i) => ({ kind: "section", sectionId: section.id, n: i }));
    }
    targets = targets.filter((t) => !activeImageJobs.has(`${project.id}:${targetKey(t)}`));
    if (!targets.length) return res.json(viewOf(project));

    const model = project.imageModel || process.env.OPENROUTER_IMAGE_MODEL || FALLBACK_IMAGE_MODEL;
    for (const t of targets) activeImageJobs.add(`${project.id}:${targetKey(t)}`);
    await mutateProject(project.id, (p) => {
      for (const t of targets) {
        const img = findImage(p, t);
        if (img) Object.assign(img, { status: "generating", error: undefined });
      }
    });

    let lastError = "";
    await mapLimit(targets, 2, async (t) => {
      const key = `${project.id}:${targetKey(t)}`;
      const prompt = findImage(project, t)?.prompt ?? "";
      try {
        const image = await generateImage({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL || undefined }, { model, prompt, aspectRatio: "16:9", resolution: "2K" });
        const previous = findImage(await getProject(project.id), t)?.file;
        const name = imageFileName(t.kind === "thumbnail" ? "thumbnail" : { sectionId: t.sectionId, n: t.n }, image.ext);
        await saveImageFile(project.id, name, image.data, previous);
        await updateImage(project.id, t, (img) => Object.assign(img, { status: "done", file: name, source: "ai", generatedAt: new Date().toISOString(), error: undefined }));
      } catch (error: any) {
        lastError = error?.message || "Error al generar la imagen.";
        console.error("Image Error:", error);
        await updateImage(project.id, t, (img) => Object.assign(img, { status: "error", error: lastError }));
      } finally {
        activeImageJobs.delete(key);
      }
    });
    const updated = viewOf(await getProject(project.id));
    if (lastError && targets.length === 1) return res.status(502).json({ error: lastError, project: updated });
    res.json(updated);
  } catch (error) {
    sendError(res, error, "Error al generar las imágenes.");
  }
});

// Sube una imagen propia en lugar de la generada (cuerpo binario, Content-Type image/*).
app.post("/api/projects/:id/images/upload", express.raw({ type: "image/*", limit: "25mb" }), async (req, res) => {
  try {
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[req.headers["content-type"] ?? ""];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Sube una imagen PNG, JPG o WebP." });
    const target = String(req.query.target ?? "");
    const [sectionId, nText] = target.split(":");
    const t: ImageTarget = target === "thumbnail" ? { kind: "thumbnail" } : { kind: "section", sectionId, n: Number(nText) };
    const project = await withImagePrompts(await getProject(req.params.id));
    const current = findImage(project, t);
    if (!current) return res.status(404).json({ error: "Imagen no encontrada." });
    const name = imageFileName(t.kind === "thumbnail" ? "thumbnail" : { sectionId: t.sectionId, n: t.n }, ext);
    await saveImageFile(project.id, name, req.body, current.file);
    const updated = await updateImage(project.id, t, (img) => Object.assign(img, { status: "done", file: name, source: "upload", generatedAt: new Date().toISOString(), error: undefined }));
    res.json(viewOf(updated));
  } catch (error) {
    sendError(res, error, "Error al subir la imagen.");
  }
});

app.get("/api/projects/:id/images/:file", async (req, res) => {
  try {
    const data = await readImageFile(req.params.id, req.params.file);
    res.set({ "Content-Type": IMAGE_TYPES[req.params.file.split(".").pop() ?? ""] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" });
    res.send(data);
  } catch (error) {
    sendError(res, error, "Error al leer la imagen.");
  }
});

app.get("/api/projects/:id/sections/:sectionId/audio", async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    const index = project.sections.findIndex((s) => s.id === req.params.sectionId);
    if (index < 0) throw new NotFoundError("Sección no encontrada.");
    const wav = await readSectionAudio(project.id, req.params.sectionId);
    res.set({ "Content-Type": "audio/wav", "Content-Length": String(wav.length), "Cache-Control": "no-store" });
    if (req.query.download) res.set("Content-Disposition", contentDisposition(sectionFileName(index, project.sections[index])));
    res.send(wav);
  } catch (error) {
    sendError(res, error, "Error al leer el audio.");
  }
});

app.get("/api/projects/:id/zip", async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    const zip = await buildProjectZip(project);
    res.set({ "Content-Type": "application/zip", "Content-Length": String(zip.length), "Content-Disposition": contentDisposition(`${safeFileName(project.name)}.zip`) });
    res.send(zip);
  } catch (error) {
    sendError(res, error, "Error al preparar el ZIP.");
  }
});

// Rutas de API inexistentes: 404 en JSON, en lugar de devolver la página de la app.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Generador de audio escuchando en http://localhost:${port}`);
  });
}

start();
