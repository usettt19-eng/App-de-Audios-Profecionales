import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Film, ImageIcon, Clock, Download, FileUp, FolderOpen, FolderPlus, Loader2, Music, Pencil, Play, RefreshCw, Sparkles, Square, Trash2, TriangleAlert,
} from "lucide-react";
import { estimateDurationSeconds, listSpeakers, parseScript } from "../lib/scriptParser";
import { countBlockMarkers, importTechnicalScript } from "../lib/technicalScript";
import { parseVoiceDirection } from "../lib/voiceDirection";
import { ErrorNote } from "./AudioScriptStudio";
import ScriptGenerator from "./ScriptGenerator";
import ImageTile, { ProjectImage } from "./ImageTile";
import MusicPanel, { ProjectMusic } from "./MusicPanel";
import { DOCUMENTARY_VOICE_DIRECTION } from "../lib/scriptTemplates";
import { BUILTIN_FORMAT, BUILTIN_FORMAT_ID, ProductionFormat } from "../lib/formats";
import {
  chipButtonClass, DirectionPanel, formatDuration, ModelPicker, panelClass, Stat, useTtsCatalog, VoiceCast, voicesForModel, withDefaultVoices,
} from "./voiceControls";

interface ProductionCue {
  kind: string;
  description: string;
}

interface Section {
  id: string;
  title: string;
  script: string;
  cues: ProductionCue[];
  status: "pending" | "generating" | "done" | "error";
  error?: string;
  durationSec?: number;
  generatedAt?: string;
  stale: boolean;
  images?: ProjectImage[];
}

interface Project {
  id: string;
  name: string;
  direction: string;
  voices: Record<string, string>;
  model?: string;
  imageModel?: string;
  imagePlan?: "template" | "ai";
  thumbnail?: ProjectImage;
  video?: {
    status: "rendering" | "done" | "error";
    progress: number;
    total: number;
    error?: string;
    durationSec?: number;
    finishedAt?: string;
  };
  videoStale?: boolean;
  music?: ProjectMusic;
  sections: Section[];
  updatedAt: string;
}

interface ImageModel {
  id: string;
  name: string;
  recommended?: boolean;
}

type ImageTarget = { sectionId: string; n: number } | "thumbnail";
const targetId = (t: ImageTarget) => (t === "thumbnail" ? "thumbnail" : `${t.sectionId}:${t.n}`);

interface ProjectSummary {
  id: string;
  name: string;
  sections: number;
  done: number;
  updatedAt: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { data });
  return data as T;
}

const primaryButtonClass =
  "px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

export default function ProjectsView({ initialFormatId }: { initialFormatId?: string }) {
  const [view, setView] = useState<{ kind: "list" } | { kind: "new" } | { kind: "project"; id: string }>(initialFormatId ? { kind: "new" } : { kind: "list" });

  if (view.kind === "new") return <NewProject initialFormatId={initialFormatId} onCancel={() => setView({ kind: "list" })} onCreated={(id) => setView({ kind: "project", id })} />;
  if (view.kind === "project") return <ProjectDetail id={view.id} onBack={() => setView({ kind: "list" })} />;
  return <ProjectList onNew={() => setView({ kind: "new" })} onOpen={(id) => setView({ kind: "project", id })} />;
}

function ProjectList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProjectSummary[]>("/api/projects").then(setProjects).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-black text-slate-100">Proyectos</h2>
          <p className="text-[11px] text-slate-400">Cada proyecto agrupa los audios de un guion: uno por bloque, con la misma dirección de voz.</p>
        </div>
        <button onClick={onNew} className={primaryButtonClass}>
          <FolderPlus className="w-4 h-4" /> Nuevo proyecto
        </button>
      </div>

      {error && <ErrorNote message={error} />}
      {projects === null && !error && <Loader2 className="w-5 h-5 animate-spin text-slate-500" />}
      {projects?.length === 0 && (
        <div className={`${panelClass} items-center text-center py-10`}>
          <FolderOpen className="w-8 h-8 text-slate-600" />
          <p className="text-xs text-slate-400">Todavía no hay proyectos. Crea uno pegando un guion con sus bloques.</p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {projects?.map((p) => (
          <button key={p.id} onClick={() => onOpen(p.id)} className={`${panelClass} text-left hover:border-fuchsia-800/70 cursor-pointer`}>
            <span className="text-sm font-bold text-slate-100">{p.name}</span>
            <span className="text-[11px] text-slate-400">
              {p.done}/{p.sections} audios listos · {new Date(p.updatedAt).toLocaleString("es")}
            </span>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-fuchsia-500" style={{ width: `${p.sections ? (p.done / p.sections) * 100 : 0}%` }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewProject({ initialFormatId, onCancel, onCreated }: { initialFormatId?: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const [formats, setFormats] = useState<ProductionFormat[]>([]);
  const [formatId, setFormatId] = useState(initialFormatId || BUILTIN_FORMAT_ID);
  const format = formats.find((f) => f.id === formatId);

  useEffect(() => {
    api<ProductionFormat[]>("/api/formats")
      .then(setFormats)
      .catch((e) => {
        // Sin la lista del servidor se puede seguir con el formato base incluido en la app.
        setFormats([BUILTIN_FORMAT]);
        setError(`No se pudieron cargar los formatos guardados (${e.message}). Se usa el formato base.`);
      });
  }, []);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [direction, setDirection] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"ai" | "paste">("ai");
  const [writing, setWriting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const catalog = useTtsCatalog();

  // Al generar con IA: nombre del proyecto a partir del título y dirección de voz del formato elegido.
  const startGeneration = (titulo: string) => {
    setWriting(true);
    setSource("");
    setName((current) => current || titulo.replace(/\s*\|.*$/, "").trim() || titulo);
    setDirection((current) => current || format?.direccionVoz || DOCUMENTARY_VOICE_DIRECTION);
  };

  const chooseFormat = (id: string) => {
    setFormatId(id);
    const chosen = formats.find((f) => f.id === id);
    if (chosen) setDirection(chosen.direccionVoz);
  };

  // La dirección de voz del formato se aplica al cargarlo (si todavía no se escribió otra).
  useEffect(() => {
    if (format) setDirection((current) => current || format.direccionVoz);
  }, [format?.id]);
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const model = chosenModel ?? catalog?.defaultModel ?? "";

  const preview = useMemo(() => (source.trim() ? importTechnicalScript(source) : []), [source]);
  // Aviso si el texto tiene más marcas de bloque de las que se pudieron leer (p. ej. una marca mal escrita).
  const markers = useMemo(() => countBlockMarkers(source), [source]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSource(await file.text());
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    e.target.value = "";
  };

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const project = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name, source, direction, model, formatId: mode === "ai" ? formatId : undefined }) });
      onCreated(project.id);
    } catch (e: any) {
      setError(e.message);
      setCreating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className={`lg:col-span-7 ${panelClass}`}>
        <button onClick={onCancel} className={`${chipButtonClass} self-start`}>
          <ArrowLeft className="w-3 h-3" /> Proyectos
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del proyecto (p. ej. Construcciones imposibles)"
          className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm font-bold text-slate-100 focus:outline-none focus:border-fuchsia-500/60"
        />
        <div className="flex gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 self-start">
          {([["ai", "Generar guion con IA"], ["paste", "Pegar o cargar guion"]] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              disabled={writing}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold cursor-pointer ${mode === value ? "bg-fuchsia-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "ai" && (
          <label className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Formato</span>
            <select
              value={formatId}
              onChange={(e) => chooseFormat(e.target.value)}
              disabled={writing}
              className="min-w-0 flex-1 max-w-md bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
            >
              {formats.length === 0 && <option value={formatId}>Cargando…</option>}
              {formats.map((f) => (
                <option key={f.id} value={f.id}>{f.nombre}</option>
              ))}
            </select>
          </label>
        )}
        {mode === "ai" && format && (
          <ScriptGenerator
            key={format.id + format.updatedAt}
            preset={{ titulo: format.titulo, template: format.promptGuion, duracion: format.duracion, segmentos: format.segmentos }}
            onStart={startGeneration}
            onText={setSource}
            onDone={() => setWriting(false)}
          />
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Guion completo {mode === "ai" && "(editable)"}</span>
          {mode === "paste" && (
            <button onClick={() => fileInputRef.current?.click()} className={chipButtonClass}>
              <FileUp className="w-3 h-3" /> Cargar archivo
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={handleFile} />
        </div>
        <textarea
          readOnly={writing}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          placeholder={"Pega aquí el guion técnico. Cada [BLOQUE N — TÍTULO] será un audio separado.\n\n### **[BLOQUE 1 — GANCHO]**\n**(MÚSICA: Inicio cinemático...)**\n*(Tono: Intrigante, pausado)*\nHay un edificio en el desierto...\n*(Pausa de 1 segundo)*"}
          className="w-full min-h-[420px] bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
        />
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Se reconocen <code className="text-fuchsia-300">[BLOQUE …]</code>, <code className="text-fuchsia-300">(MÚSICA: …)</code> y{" "}
          <code className="text-fuchsia-300">(SFX: …)</code> como indicaciones de producción (no se locutan),{" "}
          <code className="text-fuchsia-300">(Tono: …)</code>, <code className="text-fuchsia-300">(Enfático)</code>,{" "}
          <code className="text-fuchsia-300">(Pausa de 1 segundo)</code>, <code className="text-fuchsia-300">(Pausa táctica)</code> y palabras en{" "}
          <code className="text-fuchsia-300">**negrita**</code> como énfasis.
        </p>
      </div>

      <div className="lg:col-span-5 flex flex-col gap-4">
        <div className={panelClass}>
          <ModelPicker catalog={catalog} value={model} onChange={setChosenModel} />
        </div>
        <DirectionPanel value={direction} onChange={setDirection} />

        <div className={panelClass}>
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Audios detectados: {preview.length}</h3>
          {preview.length === 0 && <p className="text-[11px] text-slate-500">Pega un guion para ver cómo se dividirá.</p>}
          {markers > preview.length && (
            <p className="flex gap-1.5 text-[11px] text-amber-300 leading-relaxed">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
              El texto tiene {markers} marcas de bloque pero solo se reconocieron {preview.length}. Revisa que cada una esté en su propia línea, como
              [BLOQUE N — NOMBRE].
            </p>
          )}
          <ol className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {preview.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-200 truncate">
                  <span className="text-slate-500 font-mono">{String(i + 1).padStart(2, "0")}</span> {s.title}
                </span>
                <span className="text-slate-500 shrink-0">
                  ~{formatDuration(estimateDurationSeconds(parseScript(s.script)))}
                  {s.cues.length > 0 && ` · ${s.cues.length} cue${s.cues.length > 1 ? "s" : ""}`}
                </span>
              </li>
            ))}
          </ol>
          <button onClick={create} disabled={creating || writing || preview.length === 0} className={primaryButtonClass}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
            Crear proyecto con {preview.length} audio{preview.length === 1 ? "" : "s"}
          </button>
          {error && <ErrorNote message={error} />}
        </div>
      </div>
    </div>
  );
}

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const stopRequested = useRef(false);
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestSettings = useRef<{ direction: string; voices: Record<string, string>; model?: string } | null>(null);
  const catalog = useTtsCatalog();

  useEffect(() => {
    api<Project>(`/api/projects/${id}`).then(setProject).catch((e) => setError(e.message));
  }, [id]);

  const speakers = useMemo(() => {
    if (!project) return [];
    const all = project.sections.flatMap((s) => listSpeakers(parseScript(s.script)));
    return [...new Set(all)];
  }, [project?.sections]);

  const direction = project ? parseVoiceDirection(project.direction) : undefined;
  const model = project?.model || catalog?.defaultModel || "";
  const available = voicesForModel(catalog, model);

  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    const settings = latestSettings.current;
    if (settings) {
      latestSettings.current = null;
      pendingSave.current = pendingSave.current
        .then(() => api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(settings) }))
        .then((p) => setProject((prev) => (prev ? { ...prev, sections: p.sections } : p)))
        .catch((e) => setError(e.message));
    }
    return pendingSave.current;
  }, [id]);

  // Los cambios de dirección y reparto se guardan solos, agrupados tras una breve pausa al escribir.
  const updateSettings = (patch: Partial<Pick<Project, "direction" | "voices" | "model">>) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      latestSettings.current = { direction: next.direction, voices: next.voices, model: next.model || undefined };
      return next;
    });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 800);
  };

  useEffect(() => () => void flushSave(), [flushSave]);

  useEffect(() => {
    if (project && speakers.length) {
      const voices = withDefaultVoices(project.voices, speakers, direction?.suggestedVoice, available);
      if (voices !== project.voices) updateSettings({ voices });
    }
  }, [speakers, project?.id, available]); // La voz sugerida solo se usa para personajes nuevos.

  // Respuesta del servidor: bloques (audio e imágenes), miniatura y modelo de imagen son la fuente de verdad.
  const applyServerSections = (p: Project) =>
    setProject((prev) =>
      prev
        ? { ...prev, sections: p.sections, thumbnail: p.thumbnail, imageModel: p.imageModel, imagePlan: p.imagePlan, video: p.video, videoStale: p.videoStale, music: p.music }
        : p
    );

  // --- Video ---
  const renderVideo = async () => {
    try {
      applyServerSections(await api<Project>(`/api/projects/${id}/video/render`, { method: "POST" }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Mientras se monta el video, se consulta el progreso cada pocos segundos.
  const videoRendering = project?.video?.status === "rendering";
  useEffect(() => {
    if (!videoRendering) return;
    const timer = setInterval(() => {
      api<Project>(`/api/projects/${id}`).then(applyServerSections).catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [videoRendering, id]);

  // --- Imágenes ---
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [defaultImageModel, setDefaultImageModel] = useState("");
  const [imagesRunning, setImagesRunning] = useState(false);
  const [planning, setPlanning] = useState(false);
  const stopImages = useRef(false);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;

  // El director de arte escribe los prompts de cada bloque a partir de su narración. Se hace una vez
  // antes de generar (o a mano con "Rehacer prompts con IA"). Devuelve el proyecto actualizado.
  const planImages = async (force: boolean): Promise<Project | null> => {
    setPlanning(true);
    try {
      const p = await api<Project>(`/api/projects/${id}/images/plan`, { method: "POST", body: JSON.stringify({ force }) });
      applyServerSections(p);
      return p;
    } catch (e: any) {
      setError(`No se pudieron preparar los prompts de imagen: ${e.message}`);
      return null;
    } finally {
      setPlanning(false);
    }
  };

  const ensurePlan = async (): Promise<Project | null> =>
    projectRef.current?.imagePlan === "ai" ? projectRef.current : planImages(false);

  useEffect(() => {
    api<{ defaultModel: string; models: ImageModel[] }>("/api/image-models")
      .then((data) => {
        setImageModels(data.models);
        setDefaultImageModel(data.defaultModel);
      })
      .catch(() => undefined);
  }, []);

  const markImages = (targets: ImageTarget[], patch: Partial<ProjectImage>) =>
    setProject((prev) => {
      if (!prev) return prev;
      const ids = new Set(targets.map(targetId));
      return {
        ...prev,
        thumbnail: prev.thumbnail && ids.has("thumbnail") ? { ...prev.thumbnail, ...patch } : prev.thumbnail,
        sections: prev.sections.map((s) => ({ ...s, images: s.images?.map((img, n) => (ids.has(`${s.id}:${n}`) ? { ...img, ...patch } : img)) })),
      };
    });

  const generateImages = async (body: { sectionId?: string; n?: number; thumbnail?: boolean }, optimistic: ImageTarget[]) => {
    markImages(optimistic, { status: "generating", error: undefined });
    try {
      applyServerSections(await api<Project>(`/api/projects/${id}/images/generate`, { method: "POST", body: JSON.stringify(body) }));
    } catch (e: any) {
      if (e.data?.project) applyServerSections(e.data.project);
      else markImages(optimistic, { status: "error", error: e.message });
    }
  };

  const sectionPendingTargets = (s: Section): ImageTarget[] =>
    (s.images ?? []).map((img, n) => (img.status === "done" ? null : { sectionId: s.id, n })).filter((t): t is { sectionId: string; n: number } => t !== null);

  const generateAllImages = async () => {
    stopImages.current = false;
    setImagesRunning(true);
    const planned = await ensurePlan();
    if (planned) {
      for (const s of planned.sections) {
        if (stopImages.current) break;
        const targets = sectionPendingTargets(s);
        if (targets.length) await generateImages({ sectionId: s.id }, targets);
      }
      if (!stopImages.current && planned.thumbnail?.status !== "done") await generateImages({ thumbnail: true }, ["thumbnail"]);
    }
    setImagesRunning(false);
  };

  const replanImages = async () => {
    if (!window.confirm("La IA reescribirá los prompts de todas las imágenes a partir de lo que narra cada bloque. Las imágenes generadas quedarán pendientes de regenerar (las subidas a mano se conservan). ¿Continuar?")) return;
    await planImages(true);
  };

  // Generar desde un bloque o una imagen suelta también pasa antes por el director de arte.
  const generateWithPlan = async (body: { sectionId?: string; n?: number; thumbnail?: boolean }, optimistic: (p: Project) => ImageTarget[]) => {
    const planned = await ensurePlan();
    if (planned) await generateImages(body, optimistic(planned));
  };

  const uploadImage = async (target: ImageTarget, file: File) => {
    try {
      const res = await fetch(`/api/projects/${id}/images/upload?target=${encodeURIComponent(targetId(target))}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo subir la imagen.");
      applyServerSections(data);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveImagePrompt = async (target: ImageTarget, prompt: string) => {
    markImages([target], { prompt });
    try {
      applyServerSections(
        await api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ imagePrompts: [{ target: targetId(target), prompt }] }) })
      );
    } catch (e: any) {
      setError(e.message);
    }
  };

  const chooseImageModel = async (imageModel: string) => {
    setProject((prev) => (prev ? { ...prev, imageModel } : prev));
    try {
      applyServerSections(await api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ imageModel }) }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const markSection = (sectionId: string, patch: Partial<Section>) =>
    setProject((prev) => (prev ? { ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)) } : prev));

  const generateSection = async (sectionId: string) => {
    await flushSave();
    markSection(sectionId, { status: "generating", error: undefined });
    try {
      applyServerSections(await api<Project>(`/api/projects/${id}/sections/${sectionId}/generate`, { method: "POST" }));
    } catch (e: any) {
      if (e.data?.project) applyServerSections(e.data.project);
      else markSection(sectionId, { status: "error", error: e.message });
    }
  };

  const generatePending = async () => {
    if (!project) return;
    stopRequested.current = false;
    setBatchRunning(true);
    const queue = project.sections.filter((s) => s.status !== "done" || s.stale).map((s) => s.id);
    for (const sectionId of queue) {
      if (stopRequested.current) break;
      await generateSection(sectionId);
    }
    setBatchRunning(false);
  };

  const saveSection = async (sectionId: string, patch: { title?: string; script?: string }) => {
    try {
      applyServerSections(await api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ sections: [{ id: sectionId, ...patch }] }) }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeProject = async () => {
    if (!project || !window.confirm(`¿Eliminar el proyecto "${project.name}" y todos sus audios?`)) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    onBack();
  };

  const rename = async () => {
    const name = window.prompt("Nuevo nombre del proyecto:", project?.name)?.trim();
    if (!name) return;
    try {
      const p = await api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setProject((prev) => (prev ? { ...prev, name: p.name } : p));
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!project) {
    return error ? <ErrorNote message={error} /> : <Loader2 className="w-5 h-5 animate-spin text-slate-500" />;
  }

  const done = project.sections.filter((s) => s.status === "done").length;
  const allImages = [...project.sections.flatMap((s) => s.images ?? []), ...(project.thumbnail ? [project.thumbnail] : [])];
  const imagesDone = allImages.filter((img) => img.status === "done").length;
  const imagesTotal = allImages.length;
  const pending = project.sections.filter((s) => s.status !== "done" || s.stale).length;
  const totalSeconds = project.sections.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-2">
          <button onClick={onBack} className={`${chipButtonClass} self-start`}>
            <ArrowLeft className="w-3 h-3" /> Proyectos
          </button>
          <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
            {project.name}
            <button onClick={rename} aria-label="Renombrar proyecto" className="text-slate-500 hover:text-slate-200 cursor-pointer">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {batchRunning ? (
            <button onClick={() => (stopRequested.current = true)} className={`${chipButtonClass} py-2`}>
              <Square className="w-3.5 h-3.5" /> Detener tras el audio actual
            </button>
          ) : (
            <button onClick={generatePending} disabled={pending === 0} className={primaryButtonClass}>
              <Sparkles className="w-4 h-4" /> {pending ? `Generar ${pending} pendiente${pending > 1 ? "s" : ""}` : "Todo generado"}
            </button>
          )}
          <a href={`/api/projects/${id}/zip`} className={`${chipButtonClass} py-2 ${done === 0 && imagesDone === 0 ? "pointer-events-none opacity-40" : ""}`}>
            <Download className="w-3.5 h-3.5" /> Descargar ZIP
          </a>
          <button onClick={removeProject} className={`${chipButtonClass} py-2 hover:text-rose-300`}>
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </button>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 flex flex-col gap-3">
          {project.sections.map((section, i) => (
            <SectionCard
              key={section.id}
              index={i}
              projectId={id}
              section={section}
              speedPercent={direction?.speedPercent}
              busy={batchRunning}
              onGenerate={() => generateSection(section.id)}
              onSave={(patch) => saveSection(section.id, patch)}
              imagesBusy={imagesRunning || planning}
              onGenerateImages={() =>
                generateWithPlan({ sectionId: section.id }, (p) => sectionPendingTargets(p.sections.find((x) => x.id === section.id) ?? section))
              }
              onGenerateImage={(n) => generateWithPlan({ sectionId: section.id, n }, () => [{ sectionId: section.id, n }])}
              onUploadImage={(n, file) => uploadImage({ sectionId: section.id, n }, file)}
              onImagePrompt={(n, prompt) => saveImagePrompt({ sectionId: section.id, n }, prompt)}
            />
          ))}
        </div>

        <div className="lg:col-span-4 flex flex-col gap-4">
          <VideoPanel
            projectId={id}
            project={project}
            audiosMissing={project.sections.length - done}
            imagesDone={imagesDone}
            onRender={renderVideo}
          />
          <MusicPanel<Project>
            projectId={id}
            music={project.music}
            sectionTitles={project.sections.map((s) => s.title)}
            onProject={applyServerSections}
            onError={setError}
          />
          <div className={panelClass}>
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-fuchsia-400" />
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Imágenes</h3>
              <span className="ml-auto text-[11px] text-slate-500">{imagesDone} de {imagesTotal}</span>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Modelo</span>
              <select
                value={project.imageModel || defaultImageModel}
                onChange={(e) => chooseImageModel(e.target.value)}
                className="min-w-0 max-w-[65%] bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
              >
                {imageModels.length === 0 && <option value={project.imageModel || defaultImageModel}>{project.imageModel || defaultImageModel || "Cargando…"}</option>}
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.recommended ? "★ " : ""}{m.name}</option>
                ))}
              </select>
            </label>
            {planning ? (
              <p className="flex items-center justify-center gap-2 text-[11px] text-slate-400 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> La IA está escribiendo los prompts a partir de la narración…
              </p>
            ) : imagesRunning ? (
              <button onClick={() => (stopImages.current = true)} className={`${chipButtonClass} justify-center py-2`}>
                <Square className="w-3.5 h-3.5" /> Detener tras el bloque actual
              </button>
            ) : (
              <button onClick={generateAllImages} disabled={imagesDone === imagesTotal} className={primaryButtonClass}>
                <Sparkles className="w-4 h-4" /> {imagesDone === imagesTotal ? "Imágenes listas" : `Generar ${imagesTotal - imagesDone} imágenes pendientes`}
              </button>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">
                {project.imagePlan === "ai" ? "Prompts escritos por la IA según la narración." : "Los prompts se ajustarán con IA a la narración al generar."}
              </span>
              <button onClick={replanImages} disabled={planning || imagesRunning} className={chipButtonClass} title="Reescribir los prompts de todas las imágenes según la narración">
                <RefreshCw className="w-3 h-3" /> Rehacer prompts con IA
              </button>
            </div>
            {project.thumbnail && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Miniatura</span>
                <ImageTile
                  projectId={id}
                  image={project.thumbnail}
                  disabled={imagesRunning}
                  onGenerate={() => generateWithPlan({ thumbnail: true }, () => ["thumbnail"])}
                  onUpload={(file) => uploadImage("thumbnail", file)}
                  onPromptChange={(prompt) => saveImagePrompt("thumbnail", prompt)}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Audios listos" value={`${done} de ${project.sections.length}`} />
            <Stat icon={<Clock className="w-3.5 h-3.5" />} label="Duración total" value={formatDuration(totalSeconds)} />
          </div>
          <DirectionPanel
            value={project.direction}
            onChange={(value) => updateSettings({ direction: value })}
            onApplySuggestedVoice={
              available.some((v) => v.name === direction?.suggestedVoice)
                ? (voice) => updateSettings({ voices: Object.fromEntries(speakers.map((sp) => [sp, voice])) })
                : undefined
            }
          />
          <VoiceCast
            speakers={speakers}
            voices={project.voices}
            onChange={(voices) => updateSettings({ voices })}
            available={available}
            header={<ModelPicker catalog={catalog} value={model} onChange={(m) => updateSettings({ model: m })} />}
          >
            <p className="text-[10px] text-slate-500">Los cambios de modelo, dirección o voces marcan como desactualizados los audios ya generados.</p>
          </VoiceCast>
        </div>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendiente", className: "bg-slate-800 text-slate-300" },
  generating: { label: "Generando…", className: "bg-amber-950/60 text-amber-300" },
  done: { label: "Listo", className: "bg-emerald-950/60 text-emerald-300" },
  stale: { label: "Desactualizado", className: "bg-orange-950/60 text-orange-300" },
  error: { label: "Error", className: "bg-rose-950/60 text-rose-300" },
};

function SectionCard({
  index, projectId, section, speedPercent, busy, onGenerate, onSave, imagesBusy, onGenerateImages, onGenerateImage, onUploadImage, onImagePrompt,
}: {
  index: number;
  projectId: string;
  section: Section;
  speedPercent?: number;
  busy: boolean;
  onGenerate: () => void;
  onSave: (patch: { title?: string; script?: string }) => Promise<void>;
  imagesBusy: boolean;
  onGenerateImages: () => void;
  onGenerateImage: (n: number) => void;
  onUploadImage: (n: number, file: File) => void;
  onImagePrompt: (n: number, prompt: string) => void;
}) {
  const images = section.images ?? [];
  const imagesPending = images.filter((img) => img.status !== "done" && img.status !== "generating").length;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(section.title);
  const [draftScript, setDraftScript] = useState(section.script);

  const status = STATUS_STYLES[section.stale ? "stale" : section.status];
  const estimate = estimateDurationSeconds(parseScript(section.script)) * (100 / (speedPercent || 100));
  const audioUrl = `/api/projects/${projectId}/sections/${section.id}/audio?v=${encodeURIComponent(section.generatedAt ?? "")}`;
  const generating = section.status === "generating";

  const startEditing = () => {
    setDraftTitle(section.title);
    setDraftScript(section.script);
    setEditing(true);
  };

  const save = async () => {
    await onSave({ title: draftTitle, script: draftScript });
    setEditing(false);
  };

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-slate-500">{String(index + 1).padStart(2, "0")}</span>
          {editing ? (
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-sm font-bold text-slate-100 focus:outline-none focus:border-fuchsia-500/60"
            />
          ) : (
            <h3 className="text-sm font-bold text-slate-100 truncate">{section.title}</h3>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status.className}`}>{status.label}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {section.status === "done" && section.durationSec !== undefined ? formatDuration(section.durationSec) : `~${formatDuration(estimate)}`}
          {!editing && (
            <button onClick={startEditing} disabled={generating} className={chipButtonClass}>
              <Pencil className="w-3 h-3" /> Editar
            </button>
          )}
          <button onClick={onGenerate} disabled={generating || busy || editing} className={chipButtonClass}>
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : section.status === "done" ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {section.status === "done" ? "Regenerar" : "Generar"}
          </button>
        </div>
      </div>

      {section.cues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {section.cues.map((cue, i) => (
            <span key={i} title={cue.description} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[10px] text-slate-400 max-w-full">
              <Music className="w-3 h-3 shrink-0 text-sky-400" />
              <span className="font-bold text-slate-300">{cue.kind}:</span>
              <span className="truncate">{cue.description}</span>
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draftScript}
            onChange={(e) => setDraftScript(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[220px] bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          />
          <div className="flex gap-2">
            <button onClick={save} className={primaryButtonClass}>Guardar cambios</button>
            <button onClick={() => setEditing(false)} className={chipButtonClass}>Cancelar</button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
          {section.script.split("\n").filter((l) => !l.startsWith("#") && !l.startsWith("[")).map((l) => l.replace(/^[^:]{1,80}:\s*/, "")).join(" ")}
        </p>
      )}

      {section.status === "error" && section.error && (
        <div className="flex gap-2 text-[11px] text-rose-300">
          <TriangleAlert className="w-4 h-4 shrink-0" /> {section.error}
        </div>
      )}

      {images.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Imágenes</span>
            {imagesPending > 0 && (
              <button onClick={onGenerateImages} disabled={imagesBusy} className={chipButtonClass}>
                <Sparkles className="w-3 h-3" /> Generar {imagesPending}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {images.map((img, n) => (
              <ImageTile
                key={n}
                projectId={projectId}
                image={img}
                disabled={imagesBusy}
                onGenerate={() => onGenerateImage(n)}
                onUpload={(file) => onUploadImage(n, file)}
                onPromptChange={(prompt) => onImagePrompt(n, prompt)}
              />
            ))}
          </div>
        </div>
      )}

      {section.status === "done" && (
        <div className="flex items-center gap-2">
          <audio controls preload="none" src={audioUrl} className="flex-1 h-9 min-w-0" />
          <a href={`${audioUrl}&download=1`} className={chipButtonClass} aria-label="Descargar WAV">
            <Download className="w-3.5 h-3.5" /> WAV
          </a>
        </div>
      )}
    </div>
  );
}

function VideoPanel({
  projectId, project, audiosMissing, imagesDone, onRender,
}: {
  projectId: string;
  project: Project;
  audiosMissing: number;
  imagesDone: number;
  onRender: () => void;
}) {
  const video = project.video;
  const rendering = video?.status === "rendering";
  const blocker = audiosMissing > 0 ? (audiosMissing === 1 ? "Falta 1 audio." : `Faltan ${audiosMissing} audios.`) : imagesDone === 0 ? "Genera al menos una imagen." : null;
  const src = `/api/projects/${projectId}/video?v=${encodeURIComponent(video?.finishedAt ?? "")}`;
  const pct = video && video.total ? Math.round((video.progress / video.total) * 100) : 0;

  return (
    <div className={panelClass}>
      <div className="flex items-center gap-2">
        <Film className="w-4 h-4 text-fuchsia-400" />
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Video</h3>
        {video?.status === "done" && video.durationSec !== undefined && (
          <span className="ml-auto text-[11px] text-slate-500">{formatDuration(video.durationSec)} · 1080p</span>
        )}
      </div>

      {rendering ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-[11px] text-slate-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {video!.progress === 0 ? "Preparando el montaje…" : `Montando bloque ${Math.min(video!.progress + 1, video!.total)} de ${video!.total}…`}
          </p>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[10px] text-slate-500">Puede tardar unos minutos por cada minuto de video. Puedes cerrar la página: sigue en el servidor.</p>
        </div>
      ) : (
        <>
          {video?.status === "done" && (
            <>
              <video controls preload="metadata" src={src} poster={project.thumbnail?.file ? `/api/projects/${projectId}/images/${project.thumbnail.file}` : undefined} className="w-full rounded-md bg-black aspect-video" />
              <a href={`${src}&download=1`} className={`${chipButtonClass} justify-center py-2 text-slate-200`}>
                <Download className="w-3.5 h-3.5" /> Descargar MP4
              </a>
              {project.videoStale && (
                <p className="flex gap-1.5 text-[11px] text-amber-300">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" /> Hay audios, imágenes o música nuevos desde el último montaje.
                </p>
              )}
            </>
          )}
          {video?.status === "error" && video.error && <ErrorNote message={video.error} />}
          <button onClick={onRender} disabled={!!blocker} title={blocker ?? undefined} className={primaryButtonClass}>
            <Film className="w-4 h-4" /> {video?.status === "done" ? "Volver a montar el video" : "Generar video"}
          </button>
          <p className="text-[10px] text-slate-500">
            {blocker ??
              `Ken Burns y fundidos entre las imágenes de cada bloque, sincronizado con su narración. MP4 1920×1080 a 30 fps.${
                project.music?.enabled && project.music.tracks.some((t) => t.status === "done") ? " Incluye la música de fondo." : ""
              }`}
          </p>
        </>
      )}
    </div>
  );
}
