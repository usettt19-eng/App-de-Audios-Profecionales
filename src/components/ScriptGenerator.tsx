import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RotateCcw, Sparkles, Square } from "lucide-react";
import { OUTPUT_FORMAT_RULES, wordsForDuration } from "../lib/scriptTemplates";
import { ErrorNote } from "./AudioScriptStudio";
import { chipButtonClass } from "./voiceControls";

interface TextModel {
  id: string;
  name: string;
  estimatedCost?: number;
  recommended?: boolean;
}

const inputClass =
  "bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60";

function costLabel(cost?: number): string {
  if (cost === undefined) return "";
  if (cost === 0) return " · gratis";
  return cost < 0.01 ? " · < $0.01/guion" : ` · ~$${cost.toFixed(2)}/guion`;
}

export interface ScriptPreset {
  titulo: string;
  template: string;
  duracion: string;
  segmentos: string;
}

// Genera el guion con un modelo de texto de OpenRouter y lo va escribiendo en vivo en el editor del proyecto.
// Los valores iniciales vienen del formato elegido; los cambios aquí solo afectan a esta generación
// (para cambiarlos siempre, se edita el formato en Ideas).
export default function ScriptGenerator({
  preset,
  onStart,
  onText,
  onDone,
}: {
  preset: ScriptPreset;
  onStart: (titulo: string) => void;
  onText: (text: string) => void;
  onDone: () => void;
}) {
  const [titulo, setTitulo] = useState(preset.titulo);
  const [tema, setTema] = useState("");
  const [duracion, setDuracion] = useState(preset.duracion);
  const [segmentos, setSegmentos] = useState(preset.segmentos);
  const [template, setTemplate] = useState(preset.template);
  const [showPrompt, setShowPrompt] = useState(false);
  const [models, setModels] = useState<TextModel[]>([]);
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [words, setWords] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/text-models")
      .then((r) => r.json())
      .then((data) => {
        setModels(data.models ?? []);
        setModel((current) => current || data.defaultModel || "");
      })
      .catch(() => setError("No se pudo cargar la lista de modelos de texto."));
    return () => abortRef.current?.abort();
  }, []);

  const updateTemplate = (value: string) => setTemplate(value);

  const generate = async () => {
    setError(null);
    setRunning(true);
    setWords(0);
    onStart(titulo);
    const abort = new AbortController();
    abortRef.current = abort;
    let text = "";
    try {
      const res = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, tema, duracion, segmentos, template, model }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status} al generar el guion.`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        // El servidor señala un error a mitad del guion con un carácter NUL seguido del mensaje.
        const nul = text.indexOf("\u0000");
        if (nul >= 0) {
          onText(text.slice(0, nul));
          throw new Error(text.slice(nul + 1) || "La generación se interrumpió.");
        }
        onText(text);
        setWords(text.split(/\s+/).filter(Boolean).length);
      }
    } catch (e: any) {
      if (!abort.signal.aborted) setError(e.message || "No se pudo generar el guion.");
    } finally {
      setRunning(false);
      abortRef.current = null;
      onDone();
    }
  };

  const recommended = models.filter((m) => m.recommended);
  const others = models.filter((m) => !m.recommended);

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-fuchsia-900/50 bg-fuchsia-950/10 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Título del documental</span>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={`${inputClass} text-sm font-bold`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Indicaciones adicionales (opcional)</span>
        <input
          value={tema}
          onChange={(e) => setTema(e.target.value)}
          placeholder="p. ej. incluir el Burj Khalifa y Machu Picchu; evitar la Torre Eiffel"
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Duración (min)</span>
          <input value={duracion} onChange={(e) => setDuracion(e.target.value)} className={inputClass} />
          <span className="text-[10px] text-slate-500">≈ {wordsForDuration(duracion) || "?"} palabras</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Nº de estructuras</span>
          <input value={segmentos} onChange={(e) => setSegmentos(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Modelo de texto (OpenRouter)</span>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
          {models.length === 0 && <option value={model}>{model || "Cargando…"}</option>}
          {recommended.length > 0 && (
            <optgroup label="Recomendados">
              {recommended.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{costLabel(m.estimatedCost)}</option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Todos">
              {others.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{costLabel(m.estimatedCost)}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <button onClick={() => setShowPrompt((v) => !v)} className={`${chipButtonClass} self-start`}>
        {showPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Prompt del guion
        {template !== preset.template && <span className="text-fuchsia-300">(editado)</span>}
      </button>
      {showPrompt && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={template}
            onChange={(e) => updateTemplate(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[260px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          />
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Variables: <code className="text-fuchsia-300">{"{titulo}"}</code> <code className="text-fuchsia-300">{"{tema}"}</code>{" "}
            <code className="text-fuchsia-300">{"{duracion}"}</code> <code className="text-fuchsia-300">{"{palabras}"}</code>{" "}
            <code className="text-fuchsia-300">{"{segmentos}"}</code>. Los cambios valen solo para esta generación; para guardarlos, edita el formato en
            Ideas. Al final se añaden siempre las reglas de formato que la app necesita para dividir el guion en bloques.
          </p>
          <details className="text-[10px] text-slate-500">
            <summary className="cursor-pointer">Ver reglas de formato fijas</summary>
            <pre className="whitespace-pre-wrap mt-1 font-mono">{OUTPUT_FORMAT_RULES}</pre>
          </details>
          {template !== preset.template && (
            <button onClick={() => updateTemplate(preset.template)} className={`${chipButtonClass} self-start`}>
              <RotateCcw className="w-3 h-3" /> Restaurar prompt del formato
            </button>
          )}
        </div>
      )}

      {running ? (
        <button onClick={() => abortRef.current?.abort()} className={`${chipButtonClass} justify-center py-2`}>
          <Square className="w-3.5 h-3.5" /> Detener ({words.toLocaleString("es")} palabras)
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        </button>
      ) : (
        <button
          onClick={generate}
          disabled={!titulo.trim() || !model}
          className="px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Sparkles className="w-4 h-4" /> Generar guion
        </button>
      )}
      {running && <p className="text-[10px] text-slate-500">El guion se escribe en vivo abajo. Un documental de 25-30 min suele tardar 2-4 minutos.</p>}
      {error && <ErrorNote message={error} />}
    </div>
  );
}
