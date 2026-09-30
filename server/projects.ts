// Proyectos: agrupan varios audios (uno por bloque del guion) con una dirección de voz y un reparto comunes.
// Se guardan en disco: <DATA_DIR>/<id>/project.json y un WAV por sección.

import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { ProductionCue } from "../src/lib/technicalScript";
import { importTechnicalScript } from "../src/lib/technicalScript";
import type { VisualVariation } from "../src/lib/formats";
import { buildImagePrompts, fillTemplate, subjectForSection, thumbnailSubject } from "../src/lib/imagePrompts";
import { createZip } from "./zip";

export type SectionStatus = "pending" | "generating" | "done" | "error";

// Video final montado con ffmpeg a partir de los audios y las imágenes de los bloques.
export interface ProjectVideo {
  status: "rendering" | "done" | "error";
  // Bloques ya montados / total.
  progress: number;
  total: number;
  error?: string;
  durationSec?: number;
  startedAt?: string;
  finishedAt?: string;
  // Huella de los audios e imágenes usados, para saber si el video quedó desactualizado.
  renderedFrom?: string;
}

// Imagen de un bloque (una por variación del formato) o miniatura del video.
export interface ProjectImage {
  variation: string;
  prompt: string;
  status: SectionStatus;
  error?: string;
  // Nombre del archivo en la carpeta del proyecto.
  file?: string;
  source?: "ai" | "upload";
  generatedAt?: string;
}

export interface ProjectSection {
  id: string;
  title: string;
  script: string;
  cues: ProductionCue[];
  status: SectionStatus;
  error?: string;
  durationSec?: number;
  // Huella del guion, dirección y voces con que se generó el audio, para detectar audios desactualizados.
  renderedFrom?: string;
  generatedAt?: string;
  images?: ProjectImage[];
}

export interface Project {
  id: string;
  name: string;
  direction: string;
  voices: Record<string, string>;
  // Modelo de voz (p. ej. "google/gemini-3.8-flash-tts" en OpenRouter); vacío = el predeterminado del servidor.
  model?: string;
  // Formato de producción con que se escribió el guion (para imágenes y miniatura).
  formatId?: string;
  // Modelo de imagen de OpenRouter; vacío = el predeterminado del servidor.
  imageModel?: string;
  // "ai": los prompts de imagen los escribió el director de arte a partir de la narración de cada bloque.
  imagePlan?: "template" | "ai";
  thumbnail?: ProjectImage;
  video?: ProjectVideo;
  sections: ProjectSection[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectView = Project & { sections: (ProjectSection & { stale: boolean })[]; videoStale?: boolean };

// Huella de lo que entra en el video: audio e imágenes de cada bloque (y sus versiones).
export function videoFingerprint(project: Pick<Project, "sections">): string {
  const parts = project.sections.map((s) => [s.generatedAt ?? "", ...(s.images ?? []).map((i) => (i.status === "done" ? `${i.file}@${i.generatedAt}` : ""))]);
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

const ID_RE = /^[0-9a-f-]{36}$/;
export const MAX_SOURCE_CHARS = 300000;

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "data/projects");
}

function projectDir(id: string): string {
  if (!ID_RE.test(id)) throw new NotFoundError("Proyecto no encontrado.");
  return path.join(dataDir(), id);
}

function audioPath(projectId: string, sectionId: string): string {
  if (!ID_RE.test(sectionId)) throw new NotFoundError("Sección no encontrada.");
  return path.join(projectDir(projectId), `${sectionId}.wav`);
}

export class NotFoundError extends Error {}

export function renderFingerprint(project: Pick<Project, "direction" | "voices" | "model">, section: Pick<ProjectSection, "script">): string {
  const inputs: unknown[] = [section.script, project.direction, project.voices];
  if (project.model) inputs.push(project.model);
  return createHash("sha1").update(JSON.stringify(inputs)).digest("hex");
}

// isActive indica qué secciones se están generando de verdad en este proceso: si el servidor se reinició
// a mitad de una generación, esa sección se muestra como interrumpida en lugar de quedarse "generando".
// isActive indica qué secciones se están generando de verdad en este proceso: si el servidor se reinició
// a mitad de una generación, esa sección se muestra como interrumpida en lugar de quedarse "generando".
// isImageActive hace lo mismo con las imágenes (clave "<sectionId>:<n>" o "thumbnail").
export function toView(
  project: Project,
  isActive: (sectionId: string) => boolean = () => false,
  isImageActive: (key: string) => boolean = () => false
): ProjectView {
  const imageView = (img: ProjectImage, key: string): ProjectImage =>
    img.status === "generating" && !isImageActive(key) ? { ...img, status: "error", error: "La generación se interrumpió. Vuelve a intentarlo." } : img;
  const video: ProjectVideo | undefined =
    project.video?.status === "rendering" && !isImageActive("video")
      ? { ...project.video, status: "error", error: "El montaje se interrumpió. Vuelve a intentarlo." }
      : project.video;
  return {
    ...project,
    video,
    videoStale: video?.status === "done" && video.renderedFrom !== videoFingerprint(project),
    thumbnail: project.thumbnail && imageView(project.thumbnail, "thumbnail"),
    sections: project.sections.map((s) => {
      const interrupted = s.status === "generating" && !isActive(s.id);
      return {
        ...s,
        status: interrupted ? "error" : s.status,
        error: interrupted ? "La generación se interrumpió. Vuelve a intentarlo." : s.error,
        stale: s.status === "done" && s.renderedFrom !== renderFingerprint(project, s),
        images: s.images?.map((img, n) => imageView(img, `${s.id}:${n}`)),
      };
    }),
  };
}

// Serializa las escrituras de cada proyecto: varias secciones pueden terminar de generarse a la vez.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(id, run.catch(() => undefined));
  return run;
}

async function readProject(id: string): Promise<Project> {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir(id), "project.json"), "utf8"));
  } catch (err: any) {
    if (err.code === "ENOENT") throw new NotFoundError("Proyecto no encontrado.");
    throw err;
  }
}

async function writeProject(project: Project): Promise<void> {
  const dir = projectDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "project.json");
  await fs.writeFile(`${file}.tmp`, JSON.stringify(project, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

export async function listProjects(): Promise<{ id: string; name: string; sections: number; done: number; updatedAt: string }[]> {
  let ids: string[] = [];
  try {
    ids = (await fs.readdir(dataDir())).filter((d) => ID_RE.test(d));
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
  const projects = await Promise.all(ids.map((id) => readProject(id).catch(() => null)));
  return projects
    .filter((p): p is Project => p !== null)
    .map((p) => ({ id: p.id, name: p.name, sections: p.sections.length, done: p.sections.filter((s) => s.status === "done").length, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<Project> {
  return readProject(id);
}

export async function createProject(input: { name: string; source: string; direction?: string; model?: string; formatId?: string }): Promise<Project> {
  const imported = importTechnicalScript(input.source);
  if (!imported.length) throw new Error("No se encontró texto para locutar en el guion.");
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim() || "Proyecto sin nombre",
    direction: input.direction ?? "",
    voices: {},
    model: input.model,
    formatId: input.formatId,
    sections: imported.map((s) => ({ id: randomUUID(), title: s.title, script: s.script, cues: s.cues, status: "pending" })),
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(project);
  return project;
}

export interface ProjectPatch {
  name?: string;
  direction?: string;
  voices?: Record<string, string>;
  model?: string;
  sections?: { id: string; title?: string; script?: string }[];
}

export function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  return withLock(id, async () => {
    const project = await readProject(id);
    if (typeof patch.name === "string" && patch.name.trim()) project.name = patch.name.trim();
    if (typeof patch.direction === "string") project.direction = patch.direction;
    if (patch.voices && typeof patch.voices === "object") project.voices = patch.voices;
    if (typeof patch.model === "string" && patch.model.trim()) project.model = patch.model.trim();
    for (const change of patch.sections ?? []) {
      const section = project.sections.find((s) => s.id === change.id);
      if (!section) continue;
      if (typeof change.title === "string" && change.title.trim()) section.title = change.title.trim();
      if (typeof change.script === "string") section.script = change.script;
    }
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return project;
  });
}

export async function deleteProject(id: string): Promise<void> {
  await readProject(id);
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export function updateSection(id: string, sectionId: string, fn: (section: ProjectSection, project: Project) => void): Promise<Project> {
  return withLock(id, async () => {
    const project = await readProject(id);
    const section = project.sections.find((s) => s.id === sectionId);
    if (!section) throw new NotFoundError("Sección no encontrada.");
    fn(section, project);
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return project;
  });
}

export function mutateProject(id: string, fn: (project: Project) => void): Promise<Project> {
  return withLock(id, async () => {
    const project = await readProject(id);
    fn(project);
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return project;
  });
}

// Rellena los prompts de imagen que falten (bloques nuevos y miniatura) a partir de las plantillas del formato.
export function ensureImagePrompts(project: Project, visuals: { variaciones: VisualVariation[]; miniatura: string }): boolean {
  let changed = false;
  for (const section of project.sections) {
    if (section.images?.length) continue;
    const subject = subjectForSection(section.title, section.script, project.name);
    section.images = buildImagePrompts(visuals.variaciones, subject).map((p) => ({ ...p, status: "pending" }));
    changed = true;
  }
  if (!project.thumbnail) {
    project.thumbnail = { variation: "Miniatura", prompt: fillTemplate(visuals.miniatura, thumbnailSubject(project.sections, project.name)), status: "pending" };
    changed = true;
  }
  return changed;
}

const IMAGE_FILE_RE = /^(thumbnail|[0-9a-f-]{36}-\d+)\.(png|jpg|webp)$/;
export const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function imageFileName(key: { sectionId: string; n: number } | "thumbnail", ext: string): string {
  return `${key === "thumbnail" ? "thumbnail" : `${key.sectionId}-${key.n}`}.${ext}`;
}

export async function saveImageFile(projectId: string, name: string, data: Buffer, previous?: string): Promise<void> {
  if (!IMAGE_FILE_RE.test(name)) throw new Error("Nombre de imagen no válido.");
  const file = path.join(projectDir(projectId), name);
  await fs.writeFile(`${file}.tmp`, data);
  await fs.rename(`${file}.tmp`, file);
  // Si cambió el formato (p. ej. de png a jpg), se borra el archivo anterior.
  if (previous && previous !== name && IMAGE_FILE_RE.test(previous)) await fs.rm(path.join(projectDir(projectId), previous), { force: true });
}

export async function readImageFile(projectId: string, name: string): Promise<Buffer> {
  if (!IMAGE_FILE_RE.test(name)) throw new NotFoundError("Imagen no encontrada.");
  try {
    return await fs.readFile(path.join(projectDir(projectId), name));
  } catch (err: any) {
    if (err.code === "ENOENT") throw new NotFoundError("Imagen no encontrada.");
    throw err;
  }
}

export async function saveSectionAudio(projectId: string, sectionId: string, wav: Buffer): Promise<void> {
  const file = audioPath(projectId, sectionId);
  await fs.writeFile(`${file}.tmp`, wav);
  await fs.rename(`${file}.tmp`, file);
}

export async function readSectionAudio(projectId: string, sectionId: string): Promise<Buffer> {
  try {
    return await fs.readFile(audioPath(projectId, sectionId));
  } catch (err: any) {
    if (err.code === "ENOENT") throw new NotFoundError("Esta sección todavía no tiene audio.");
    throw err;
  }
}

export function safeFileName(text: string): string {
  return text.normalize("NFC").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "audio";
}

export function sectionFileName(index: number, section: Pick<ProjectSection, "title">): string {
  return `${String(index + 1).padStart(2, "0")} - ${safeFileName(section.title)}.wav`;
}

function formatDuration(seconds = 0): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Hoja de producción: orden de los audios, duración e indicaciones de música y efectos para la edición.
export function productionSheet(project: Project): string {
  const lines = [`PROYECTO: ${project.name}`, `Generado: ${new Date().toLocaleString("es")}`, ""];
  project.sections.forEach((s, i) => {
    const images = (s.images ?? []).filter((img) => img.status === "done").length;
    lines.push(`${sectionFileName(i, s)}  [${s.status === "done" ? formatDuration(s.durationSec) : "sin audio"}]${images ? `  · ${images} imágenes` : ""}`);
    for (const cue of s.cues) lines.push(`   ${cue.kind}: ${cue.description}`);
    lines.push("");
  });
  if (project.model) lines.push(`MODELO DE VOZ: ${project.model}`, "");
  if (project.direction.trim()) lines.push("DIRECCIÓN DE VOZ", project.direction.trim(), "");
  return lines.join("\n");
}

export async function buildProjectZip(project: Project): Promise<Buffer> {
  const entries: { name: string; data: Buffer }[] = [{ name: "00 - Hoja de produccion.txt", data: Buffer.from(productionSheet(project), "utf8") }];
  for (const [i, section] of project.sections.entries()) {
    if (section.status === "done") entries.push({ name: sectionFileName(i, section), data: await readSectionAudio(project.id, section.id) });
    // Imágenes del bloque: "imagenes/02 - Viaducto de Millau - 1 Establishing shot.png"
    for (const [n, img] of (section.images ?? []).entries()) {
      if (img.status !== "done" || !img.file) continue;
      const ext = img.file.split(".").pop();
      const base = sectionFileName(i, section).replace(/\.wav$/, "");
      entries.push({ name: `imagenes/${base} - ${n + 1} ${safeFileName(img.variation)}.${ext}`, data: await readImageFile(project.id, img.file) });
    }
  }
  if (project.thumbnail?.status === "done" && project.thumbnail.file) {
    entries.push({ name: `miniatura.${project.thumbnail.file.split(".").pop()}`, data: await readImageFile(project.id, project.thumbnail.file) });
  }
  return createZip(entries);
}

export function videoPath(projectId: string): string {
  return path.join(projectDir(projectId), "video.mp4");
}

export function projectFolder(projectId: string): string {
  return projectDir(projectId);
}

export function sectionAudioFile(projectId: string, sectionId: string): string {
  return audioPath(projectId, sectionId);
}

export function imageFilePath(projectId: string, name: string): string {
  if (!IMAGE_FILE_RE.test(name)) throw new NotFoundError("Imagen no encontrada.");
  return path.join(projectDir(projectId), name);
}
