// Almacenamiento de análisis de canales y formatos de producción (<DATA_DIR>/../research y ../formats).
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { BUILTIN_FORMAT, Niche, ProductionFormat } from "../src/lib/formats";
import { NotFoundError } from "./projects";

export interface ResearchRun {
  id: string;
  input: string;
  // De dónde salieron los datos: API de YouTube, búsqueda web o solo el texto escrito.
  source: "youtube" | "web";
  channelName?: string;
  analysis: string;
  niches: Niche[];
  model: string;
  formatIds: string[];
  createdAt: string;
}

const ID_RE = /^[0-9a-z-]{8,64}$/;

function root(kind: "research" | "formats"): string {
  // Junto a la carpeta de proyectos, para que el mismo volumen de Docker lo guarde todo.
  return path.join(path.dirname(path.resolve(process.env.DATA_DIR || "data/projects")), kind);
}

function file(kind: "research" | "formats", id: string): string {
  if (!ID_RE.test(id)) throw new NotFoundError("No encontrado.");
  return path.join(root(kind), `${id}.json`);
}

async function readJson<T>(kind: "research" | "formats", id: string): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file(kind, id), "utf8"));
  } catch (err: any) {
    if (err.code === "ENOENT") throw new NotFoundError(kind === "research" ? "Análisis no encontrado." : "Formato no encontrado.");
    throw err;
  }
}

async function writeJson(kind: "research" | "formats", id: string, value: unknown): Promise<void> {
  await fs.mkdir(root(kind), { recursive: true });
  const target = file(kind, id);
  await fs.writeFile(`${target}.tmp`, JSON.stringify(value, null, 2));
  await fs.rename(`${target}.tmp`, target);
}

async function listJson<T>(kind: "research" | "formats"): Promise<T[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(root(kind))).filter((n) => n.endsWith(".json"));
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
  const items = await Promise.all(names.map((n) => readJson<T>(kind, n.slice(0, -5)).catch(() => null)));
  return items.filter((x): x is Awaited<T> => x !== null) as T[];
}

export async function saveResearch(run: Omit<ResearchRun, "id" | "createdAt" | "formatIds">): Promise<ResearchRun> {
  const full: ResearchRun = { ...run, id: randomUUID(), formatIds: [], createdAt: new Date().toISOString() };
  await writeJson("research", full.id, full);
  return full;
}

export const getResearch = (id: string) => readJson<ResearchRun>("research", id);

export async function listResearch(): Promise<ResearchRun[]> {
  return (await listJson<ResearchRun>("research")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteResearch(id: string): Promise<void> {
  await getResearch(id);
  await fs.rm(file("research", id), { force: true });
}

export async function linkFormat(researchId: string, formatId: string): Promise<void> {
  const run = await getResearch(researchId);
  if (!run.formatIds.includes(formatId)) run.formatIds.push(formatId);
  await writeJson("research", run.id, run);
}

// El formato base (construcciones) se crea la primera vez y desde ahí se edita como cualquier otro.
async function ensureBuiltin(): Promise<void> {
  try {
    await fs.access(file("formats", BUILTIN_FORMAT.id));
  } catch {
    await writeJson("formats", BUILTIN_FORMAT.id, BUILTIN_FORMAT);
  }
}

export async function listFormats(): Promise<ProductionFormat[]> {
  await ensureBuiltin();
  return (await listJson<ProductionFormat>("formats")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getFormat(id: string): Promise<ProductionFormat> {
  if (id === BUILTIN_FORMAT.id) await ensureBuiltin();
  return readJson<ProductionFormat>("formats", id);
}

export async function saveFormat(format: ProductionFormat): Promise<ProductionFormat> {
  await writeJson("formats", format.id, format);
  return format;
}

const EDITABLE: (keyof ProductionFormat)[] = [
  "nombre", "nicho", "analisis", "titulo", "patronTitulo", "duracion", "segmentos", "promptGuion", "direccionVoz", "visuales", "miniatura", "checklist",
];

export async function updateFormat(id: string, patch: Partial<ProductionFormat>): Promise<ProductionFormat> {
  const format = await getFormat(id);
  for (const key of EDITABLE) {
    if (patch[key] !== undefined) (format as any)[key] = patch[key];
  }
  format.updatedAt = new Date().toISOString();
  return saveFormat(format);
}

export async function deleteFormat(id: string): Promise<void> {
  await getFormat(id);
  await fs.rm(file("formats", id), { force: true });
}

export const newFormatId = () => randomUUID();
