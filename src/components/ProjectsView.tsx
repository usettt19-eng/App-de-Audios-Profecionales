import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Clock, Download, FileUp, FolderOpen, FolderPlus, Loader2, Music, Pencil, Play, RefreshCw, Sparkles, Square, Trash2, TriangleAlert,
} from "lucide-react";
import { estimateDurationSeconds, listSpeakers, parseScript } from "../lib/scriptParser";
import { importTechnicalScript } from "../lib/technicalScript";
import { parseVoiceDirection } from "../lib/voiceDirection";
import { ErrorNote } from "./AudioScriptStudio";
import ScriptGenerator from "./ScriptGenerator";
import { DOCUMENTARY_VOICE_DIRECTION } from "../lib/scriptTemplates";
import { BUILTIN_FORMAT_ID, ProductionFormat } from "../lib/formats";
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
}

interface Project {
  id: string;
  name: string;
  direction: string;
  voices: Record<string, string>;
  model?: string;
  sections: Section[];
  updatedAt: string;
}

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
    api<ProductionFormat[]>("/api/formats").then(setFormats).catch(() => undefined);
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

  const applyServerSections = (p: Project) => setProject((prev) => (prev ? { ...prev, sections: p.sections } : p));

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
          <a href={`/api/projects/${id}/zip`} className={`${chipButtonClass} py-2 ${done === 0 ? "pointer-events-none opacity-40" : ""}`}>
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
            />
          ))}
        </div>

        <div className="lg:col-span-4 flex flex-col gap-4">
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
  index, projectId, section, speedPercent, busy, onGenerate, onSave,
}: {
  index: number;
  projectId: string;
  section: Section;
  speedPercent?: number;
  busy: boolean;
  onGenerate: () => void;
  onSave: (patch: { title?: string; script?: string }) => Promise<void>;
}) {
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
