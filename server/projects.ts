// Proyectos: agrupan varios audios (uno por bloque del guion) con una dirección de voz y un reparto comunes.
// Se guardan en disco: <DATA_DIR>/<id>/project.json y un WAV por sección.

import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { ProductionCue } from "../src/lib/technicalScript";
import { importTechnicalScript } from "../src/lib/technicalScript";
import { createZip } from "./zip";

export type SectionStatus = "pending" | "generating" | "done" | "error";

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
}

export interface Project {
  id: string;
  name: string;
  direction: string;
  voices: Record<string, string>;
  sections: ProjectSection[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectView = Project & { sections: (ProjectSection & { stale: boolean })[] };

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

export function renderFingerprint(project: Pick<Project, "direction" | "voices">, section: Pick<ProjectSection, "script">): string {
  return createHash("sha1").update(JSON.stringify([section.script, project.direction, project.voices])).digest("hex");
}

// isActive indica qué secciones se están generando de verdad en este proceso: si el servidor se reinició
// a mitad de una generación, esa sección se muestra como interrumpida en lugar de quedarse "generando".
export function toView(project: Project, isActive: (sectionId: string) => boolean = () => false): ProjectView {
  return {
    ...project,
    sections: project.sections.map((s) => {
      const interrupted = s.status === "generating" && !isActive(s.id);
      return {
        ...s,
        status: interrupted ? "error" : s.status,
        error: interrupted ? "La generación se interrumpió. Vuelve a intentarlo." : s.error,
        stale: s.status === "done" && s.renderedFrom !== renderFingerprint(project, s),
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

export async function createProject(input: { name: string; source: string; direction?: string }): Promise<Project> {
  const imported = importTechnicalScript(input.source);
  if (!imported.length) throw new Error("No se encontró texto para locutar en el guion.");
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim() || "Proyecto sin nombre",
    direction: input.direction ?? "",
    voices: {},
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
  sections?: { id: string; title?: string; script?: string }[];
}

export function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  return withLock(id, async () => {
    const project = await readProject(id);
    if (typeof patch.name === "string" && patch.name.trim()) project.name = patch.name.trim();
    if (typeof patch.direction === "string") project.direction = patch.direction;
    if (patch.voices && typeof patch.voices === "object") project.voices = patch.voices;
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
    lines.push(`${sectionFileName(i, s)}  [${s.status === "done" ? formatDuration(s.durationSec) : "sin audio"}]`);
    for (const cue of s.cues) lines.push(`   ${cue.kind}: ${cue.description}`);
    lines.push("");
  });
  if (project.direction.trim()) lines.push("DIRECCIÓN DE VOZ", project.direction.trim(), "");
  return lines.join("\n");
}

export async function buildProjectZip(project: Project): Promise<Buffer> {
  const entries: { name: string; data: Buffer }[] = [{ name: "00 - Hoja de produccion.txt", data: Buffer.from(productionSheet(project), "utf8") }];
  for (const [i, section] of project.sections.entries()) {
    if (section.status !== "done") continue;
    entries.push({ name: sectionFileName(i, section), data: await readSectionAudio(project.id, section.id) });
  }
  return createZip(entries);
}
