import express from "express";
import path from "path";
import { timingSafeEqual } from "crypto";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { defaultModel, EngineRegistry, generateScriptAudio, MAX_SCRIPT_CHARS } from "./scriptAudio";
import { geminiEngine } from "./engines/gemini";
import { openRouterEngine } from "./engines/openrouter";
import { availableModels } from "./ttsCatalog";
import { pcmDurationSeconds } from "./audio";
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
} from "./projects";

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
const viewOf = (project: Awaited<ReturnType<typeof getProject>>) => toView(project, (sid) => activeJobs.has(jobKey(project.id, sid)));

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
    const { name, source, direction, model } = req.body;
    if (typeof source !== "string" || !source.trim()) return res.status(400).json({ error: "Pega el guion del proyecto." });
    if (source.length > MAX_SOURCE_CHARS) return res.status(400).json({ error: `El guion supera el máximo de ${MAX_SOURCE_CHARS} caracteres.` });
    const project = await createProject({
      name: typeof name === "string" ? name : "",
      source,
      direction: typeof direction === "string" ? direction.slice(0, MAX_DIRECTION_CHARS) : "",
      model: cleanModel(model),
    });
    res.status(201).json(viewOf(project));
  } catch (error: any) {
    res.status(400).json({ error: error.message || "No se pudo crear el proyecto." });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    res.json(viewOf(await getProject(req.params.id)));
  } catch (error) {
    sendError(res, error, "Error al leer el proyecto.");
  }
});

app.patch("/api/projects/:id", async (req, res) => {
  try {
    const { name, direction, voices, sections, model } = req.body;
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
