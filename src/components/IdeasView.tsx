import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight, ChevronDown, ChevronUp, Download, FileText, Globe, Lightbulb, Loader2, RotateCcw, Save, Search, Sparkles, Square, Trash2, Youtube,
} from "lucide-react";
import { DEFAULT_ANALYSIS_PROMPT, Niche, ProductionFormat } from "../lib/formats";
import { ErrorNote } from "./AudioScriptStudio";
import { chipButtonClass, panelClass } from "./voiceControls";

interface ResearchRun {
  id: string;
  input: string;
  source: "youtube" | "web";
  channelName?: string;
  analysis: string;
  niches: Niche[];
  model: string;
  formatIds: string[];
  createdAt: string;
}

interface TextModel {
  id: string;
  name: string;
  recommended?: boolean;
}

const PROMPT_KEY = "audios-pro:prompt-analisis";
const inputClass =
  "bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60";
const primaryClass =
  "px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

function loadPrompt(): string {
  try {
    return localStorage.getItem(PROMPT_KEY) || DEFAULT_ANALYSIS_PROMPT;
  } catch {
    return DEFAULT_ANALYSIS_PROMPT;
  }
}

// Lee una respuesta en streaming: texto en vivo y, tras un carácter NUL, un JSON con el resultado final.
async function readResultStream(res: Response, onText: (text: string) => void, signal: AbortSignal): Promise<any> {
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let all = "";
  for (;;) {
    if (signal.aborted) throw new DOMException("Detenido", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    all += decoder.decode(value, { stream: true });
    const nul = all.indexOf("\u0000");
    onText(nul >= 0 ? all.slice(0, nul) : all);
  }
  const nul = all.indexOf("\u0000");
  if (nul < 0) throw new Error("La respuesta se cortó antes de terminar.");
  const result = JSON.parse(all.slice(nul + 1));
  if (result.type === "error") throw new Error(result.message);
  return result;
}

// Markdown mínimo: títulos y negritas, respetando saltos de línea.
function MarkdownText({ text }: { text: string }) {
  return (
    <div className="text-xs text-slate-300 leading-relaxed flex flex-col gap-1">
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.*)/);
        const parts = (heading ? heading[1] : line).split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? <strong key={j} className="text-slate-100">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
        );
        if (heading) return <h4 key={i} className="text-sm font-black text-slate-100 mt-2">{parts}</h4>;
        return line.trim() ? <p key={i}>{parts}</p> : <div key={i} className="h-1" />;
      })}
    </div>
  );
}

export default function IdeasView({ onUseFormat }: { onUseFormat: (formatId: string) => void }) {
  const [input, setInput] = useState("");
  const [template, setTemplate] = useState(loadPrompt);
  const [showPrompt, setShowPrompt] = useState(false);
  const [models, setModels] = useState<TextModel[]>([]);
  const [model, setModel] = useState("");
  const [liveText, setLiveText] = useState("");
  const [running, setRunning] = useState<null | "analysis" | "process">(null);
  const [sourceNote, setSourceNote] = useState("");
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [history, setHistory] = useState<ResearchRun[]>([]);
  const [formats, setFormats] = useState<ProductionFormat[]>([]);
  const [format, setFormat] = useState<ProductionFormat | null>(null);
  const [customNiche, setCustomNiche] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = () => {
    fetch("/api/research").then((r) => r.json()).then(setHistory).catch(() => undefined);
    fetch("/api/formats").then((r) => r.json()).then(setFormats).catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    fetch("/api/text-models")
      .then((r) => r.json())
      .then((data) => {
        setModels(data.models ?? []);
        setModel((m) => m || data.defaultModel || "");
      })
      .catch(() => undefined);
    return () => abortRef.current?.abort();
  }, []);

  const updateTemplate = (value: string) => {
    setTemplate(value);
    try {
      if (value === DEFAULT_ANALYSIS_PROMPT) localStorage.removeItem(PROMPT_KEY);
      else localStorage.setItem(PROMPT_KEY, value);
    } catch {
      // Sin almacenamiento: el prompt editado dura solo esta sesión.
    }
  };

  const analyze = async () => {
    setError(null);
    setRun(null);
    setFormat(null);
    setLiveText("");
    setSourceNote("");
    setRunning("analysis");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch("/api/research/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, template, model }),
        signal: abort.signal,
      });
      const source = res.headers.get("X-Research-Source");
      const channel = decodeURIComponent(res.headers.get("X-Research-Channel") || "");
      const warning = decodeURIComponent(res.headers.get("X-Research-Warning") || "");
      setSourceNote(
        [source === "youtube" ? `Datos de YouTube: ${channel}` : source === "web" ? "Datos obtenidos con búsqueda web" : "", warning].filter(Boolean).join(" · ")
      );
      const result = await readResultStream(res, setLiveText, abort.signal);
      setRun(result.research);
      refresh();
    } catch (e: any) {
      if (!abort.signal.aborted) setError(e.message);
    } finally {
      setRunning(null);
    }
  };

  const createProcess = async (niche: { index?: number; custom?: Niche }) => {
    if (!run) return;
    setError(null);
    setFormat(null);
    setLiveText("");
    setRunning("process");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch(`/api/research/${run.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nicheIndex: niche.index, niche: niche.custom, model }),
        signal: abort.signal,
      });
      const result = await readResultStream(res, setLiveText, abort.signal);
      setFormat(result.format);
      setLiveText("");
      refresh();
    } catch (e: any) {
      if (!abort.signal.aborted) setError(e.message);
    } finally {
      setRunning(null);
    }
  };

  const openRun = (r: ResearchRun) => {
    setRun(r);
    setFormat(null);
    setLiveText("");
    setError(null);
    setSourceNote(r.source === "youtube" ? `Datos de YouTube: ${r.channelName ?? ""}` : "Datos obtenidos con búsqueda web");
  };

  const removeRun = async (r: ResearchRun) => {
    if (!window.confirm(`¿Eliminar el análisis de "${r.channelName || r.input}"?`)) return;
    await fetch(`/api/research/${r.id}`, { method: "DELETE" });
    if (run?.id === r.id) setRun(null);
    refresh();
  };

  const busy = running !== null;
  const words = liveText.split(/\s+/).filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 flex flex-col gap-4">
        <div className={panelClass}>
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-fuchsia-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">1. Analizar un canal o una idea</h3>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && !busy && analyze()}
              placeholder="https://www.youtube.com/@iCuriosiviajes  ·  @canal  ·  o una idea: canales de documentales de misterio"
              className={`${inputClass} flex-1 min-w-0 text-sm`}
            />
            {running === "analysis" ? (
              <button onClick={() => abortRef.current?.abort()} className={`${chipButtonClass} py-2`}>
                <Square className="w-3.5 h-3.5" /> Detener
              </button>
            ) : (
              <button onClick={analyze} disabled={!input.trim() || !model || busy} className={primaryClass}>
                <Search className="w-4 h-4" /> Analizar
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              Modelo
              <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
                {models.length === 0 && <option value={model}>{model || "Cargando…"}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.recommended ? "★ " : ""}{m.name}</option>
                ))}
              </select>
            </label>
            <button onClick={() => setShowPrompt((v) => !v)} className={chipButtonClass}>
              {showPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Prompt de análisis
              {template !== DEFAULT_ANALYSIS_PROMPT && <span className="text-fuchsia-300">(editado)</span>}
            </button>
          </div>
          {showPrompt && (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={template}
                onChange={(e) => updateTemplate(e.target.value)}
                className="w-full min-h-[110px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
              />
              <p className="text-[10px] text-slate-500">
                Se le añaden el canal o la idea, los datos del canal y el formato de respuesta (análisis + 3 nichos). Los cambios se guardan en este navegador.
              </p>
              {template !== DEFAULT_ANALYSIS_PROMPT && (
                <button onClick={() => updateTemplate(DEFAULT_ANALYSIS_PROMPT)} className={`${chipButtonClass} self-start`}>
                  <RotateCcw className="w-3 h-3" /> Restaurar prompt original
                </button>
              )}
            </div>
          )}
          {sourceNote && (
            <p className="flex items-center gap-1.5 text-[11px] text-sky-300">
              {sourceNote.startsWith("Datos de YouTube") ? <Youtube className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />} {sourceNote}
            </p>
          )}
          {error && <ErrorNote message={error} />}
        </div>

        {running === "analysis" && (
          <div className={panelClass}>
            <p className="flex items-center gap-2 text-[11px] text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizando… {words} palabras
            </p>
            <MarkdownText text={liveText.replace(/```json[\s\S]*$/, "")} />
          </div>
        )}

        {run && (
          <div className={panelClass}>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Análisis: {run.channelName || run.input}</h3>
            <MarkdownText text={run.analysis} />
          </div>
        )}

        {run && (
          <div className={panelClass}>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">2. Elige un nicho</h3>
            {run.niches.length === 0 && <p className="text-[11px] text-amber-300">El modelo no devolvió la lista de nichos. Escribe uno abajo o vuelve a analizar.</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {run.niches.map((n, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <span className="text-sm font-bold text-slate-100">{n.nombre}</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed flex-1">{n.porQue}</p>
                  <button onClick={() => createProcess({ index: i })} disabled={busy} className={primaryClass}>
                    <Sparkles className="w-3.5 h-3.5" /> Crear proceso
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input
                value={customNiche}
                onChange={(e) => setCustomNiche(e.target.value)}
                placeholder="u otro nicho: p. ej. puentes y túneles extremos"
                className={`${inputClass} flex-1 min-w-0`}
              />
              <button
                onClick={() => createProcess({ custom: { nombre: customNiche, porQue: "" } })}
                disabled={busy || !customNiche.trim()}
                className={chipButtonClass}
              >
                <Sparkles className="w-3 h-3" /> Crear proceso
              </button>
            </div>
          </div>
        )}

        {running === "process" && (
          <div className={panelClass}>
            <p className="flex items-center gap-2 text-[11px] text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Creando el proceso de producción… {words} palabras (1-2 min)
              <button onClick={() => abortRef.current?.abort()} className={chipButtonClass}>
                <Square className="w-3 h-3" /> Detener
              </button>
            </p>
          </div>
        )}

        {format && <FormatEditor key={format.id} format={format} onSaved={(f) => { setFormat(f); refresh(); }} onUse={() => onUseFormat(format.id)} />}
      </div>

      <div className="lg:col-span-4 flex flex-col gap-4">
        <div className={panelClass}>
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Formatos guardados</h3>
          {formats.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2">
              <button onClick={() => { setFormat(f); setLiveText(""); }} className="text-left text-xs text-slate-200 hover:text-white truncate cursor-pointer">
                <FileText className="w-3.5 h-3.5 inline mr-1 text-fuchsia-400" />
                {f.nombre}
              </button>
              <button onClick={() => onUseFormat(f.id)} className={chipButtonClass} title="Crear proyecto con este formato">
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className={panelClass}>
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Análisis anteriores</h3>
          {history.length === 0 && <p className="text-[11px] text-slate-500">Todavía no hay análisis.</p>}
          {history.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <button onClick={() => openRun(r)} className="text-left min-w-0 cursor-pointer">
                <span className="block text-xs text-slate-200 truncate">{r.channelName || r.input}</span>
                <span className="block text-[10px] text-slate-500">
                  {new Date(r.createdAt).toLocaleString("es")} · {r.niches.length} nichos · {r.formatIds.length} formatos
                </span>
              </button>
              <button onClick={() => removeRun(r)} aria-label="Eliminar análisis" className="text-slate-600 hover:text-rose-400 cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const fieldLabel = "text-[11px] font-bold text-slate-400 uppercase tracking-wide";
const areaClass =
  "w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y";

// Editor del proceso de producción (formato): los mismos apartados que el documento de proceso.
function FormatEditor({ format, onSaved, onUse }: { format: ProductionFormat; onSaved: (f: ProductionFormat) => void; onUse: () => void }) {
  const [draft, setDraft] = useState(format);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(format);
  const set = <K extends keyof ProductionFormat>(key: K, value: ProductionFormat[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/formats/${format.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");
      onSaved(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">3. Proceso de producción</h3>
        <div className="flex gap-2 flex-wrap">
          <button onClick={save} disabled={!dirty || saving} className={chipButtonClass}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Guardar cambios
          </button>
          <a href={`/api/formats/${format.id}/markdown`} className={chipButtonClass}>
            <Download className="w-3 h-3" /> Descargar .md
          </a>
          <button onClick={onUse} disabled={dirty} title={dirty ? "Guarda los cambios primero" : undefined} className={primaryClass}>
            <ArrowRight className="w-4 h-4" /> Crear proyecto con este formato
          </button>
        </div>
      </div>
      {error && <ErrorNote message={error} />}

      <input value={draft.nombre} onChange={(e) => set("nombre", e.target.value)} className={`${inputClass} text-sm font-bold`} />
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Nicho</span>
        <input value={draft.nicho} onChange={(e) => set("nicho", e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>1. Análisis del formato base</span>
        <textarea value={draft.analisis} onChange={(e) => set("analisis", e.target.value)} className={`${areaClass} min-h-[120px]`} />
      </label>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 md:col-span-3">
          <span className={fieldLabel}>Título sugerido</span>
          <input value={draft.titulo} onChange={(e) => set("titulo", e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Patrón de título</span>
          <input value={draft.patronTitulo} onChange={(e) => set("patronTitulo", e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Duración (min)</span>
          <input value={draft.duracion} onChange={(e) => set("duracion", e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Nº de segmentos</span>
          <input value={draft.segmentos} onChange={(e) => set("segmentos", e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>2. Prompt del guion</span>
        <textarea value={draft.promptGuion} onChange={(e) => set("promptGuion", e.target.value)} className={`${areaClass} min-h-[220px]`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>3. Narración (dirección de voz)</span>
        <textarea value={draft.direccionVoz} onChange={(e) => set("direccionVoz", e.target.value)} className={`${areaClass} min-h-[140px]`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>4. Visuales: plantilla base</span>
        <textarea
          value={draft.visuales.plantillaBase}
          onChange={(e) => set("visuales", { ...draft.visuales, plantillaBase: e.target.value })}
          className={`${areaClass} min-h-[70px]`}
        />
      </label>
      {draft.visuales.variaciones.map((v, i) => (
        <label key={i} className="flex flex-col gap-1">
          <span className={fieldLabel}>Variación {i + 1}: {v.nombre}</span>
          <textarea
            value={v.prompt}
            onChange={(e) =>
              set("visuales", { ...draft.visuales, variaciones: draft.visuales.variaciones.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)) })
            }
            className={`${areaClass} min-h-[50px]`}
          />
        </label>
      ))}
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Animación</span>
        <textarea value={draft.visuales.animacion} onChange={(e) => set("visuales", { ...draft.visuales, animacion: e.target.value })} className={`${areaClass} min-h-[50px]`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>5. Miniatura</span>
        <textarea value={draft.miniatura} onChange={(e) => set("miniatura", e.target.value)} className={`${areaClass} min-h-[60px]`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>6. Checklist (una tarea por línea)</span>
        <textarea
          value={draft.checklist.join("\n")}
          onChange={(e) => set("checklist", e.target.value.split("\n"))}
          onBlur={() => set("checklist", draft.checklist.map((c) => c.trim()).filter(Boolean))}
          className={`${areaClass} min-h-[110px]`}
        />
      </label>
      <p className="text-[10px] text-slate-500">
        En los prompts de imagen, <code className="text-fuchsia-300">{"{elemento}"}</code> se reemplazará por lo que trata cada bloque del guion.
      </p>
    </div>
  );
}
