import React, { useEffect, useMemo, useState } from "react";
import { Cpu, Mic, Save, SlidersHorizontal, Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { GEMINI_VOICES, KNOWN_MODELS, modelUsesGeminiVoices, TtsModelInfo, VoiceOption } from "../lib/ttsModels";
import { directionSummary, MAX_DIRECTION_CHARS, parseVoiceDirection, VoiceDirection } from "../lib/voiceDirection";

export interface TtsCatalog {
  defaultModel: string;
  configured: { openrouter: boolean; gemini: boolean };
  models: TtsModelInfo[];
}

// Catálogo de modelos del servidor (OpenRouter en vivo + conocidos). Se pide una vez por carga de página.
let catalogPromise: Promise<TtsCatalog> | null = null;
export function useTtsCatalog(): TtsCatalog | null {
  const [catalog, setCatalog] = useState<TtsCatalog | null>(null);
  useEffect(() => {
    catalogPromise ??= fetch("/api/tts/models").then((r) => {
      if (!r.ok) throw new Error("No se pudo cargar la lista de modelos.");
      return r.json();
    });
    catalogPromise.then(setCatalog).catch(() => {
      catalogPromise = null;
      setCatalog({ defaultModel: KNOWN_MODELS[0].id, configured: { openrouter: false, gemini: false }, models: KNOWN_MODELS });
    });
  }, []);
  return catalog;
}

// Voces del modelo: las del catálogo; si no se conocen, las de Gemini para modelos Gemini o ninguna (texto libre).
export function voicesForModel(catalog: TtsCatalog | null, modelId: string): VoiceOption[] {
  const known = catalog?.models.find((m) => m.id === modelId)?.voices;
  if (known?.length) return known;
  return modelUsesGeminiVoices(modelId) ? GEMINI_VOICES : [];
}

const GEMINI_ROTATION = ["Charon", "Kore", "Puck", "Aoede", "Algenib", "Leda", "Sulafat", "Iapetus"];

// Completa el reparto con una voz válida para cada personaje sin pisar las elecciones existentes.
// Si el modelo tiene lista de voces, las que no pertenecen a ella se reemplazan (p. ej. al cambiar de modelo).
// El primer personaje toma la voz sugerida por el prompt de dirección, si el modelo la tiene.
export function withDefaultVoices(
  voices: Record<string, string>,
  speakers: string[],
  suggested?: string,
  available: VoiceOption[] = GEMINI_VOICES
): Record<string, string> {
  const names = available.map((v) => v.name);
  const valid = (voice?: string) => !!voice && (!names.length || names.includes(voice));
  const rotation = names.length ? (names.some((n) => GEMINI_ROTATION.includes(n)) ? GEMINI_ROTATION.filter((n) => names.includes(n)) : names) : [];
  let changed = false;
  const next = { ...voices };
  speakers.forEach((speaker, i) => {
    if (valid(next[speaker]) || (!names.length && next[speaker] !== undefined)) return;
    const fallback = rotation.length ? rotation[i % rotation.length] : "";
    next[speaker] = i === 0 && suggested && valid(suggested) ? suggested : fallback;
    changed = true;
  });
  return changed ? next : voices;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

export const panelClass = "bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3";
export const chipButtonClass =
  "px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer";

const SAVED_DIRECTIONS_KEY = "audios-pro:direcciones";

interface SavedDirection {
  name: string;
  text: string;
}

function loadSavedDirections(): SavedDirection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_DIRECTIONS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeSavedDirections(list: SavedDirection[]) {
  try {
    localStorage.setItem(SAVED_DIRECTIONS_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento disponible (modo privado): los prompts guardados duran solo esta sesión.
  }
}

export function useParsedDirection(direction: string): VoiceDirection | undefined {
  return useMemo(() => (direction.trim() ? parseVoiceDirection(direction) : undefined), [direction]);
}

export function DirectionPanel({
  value,
  onChange,
  onApplySuggestedVoice,
}: {
  value: string;
  onChange: (value: string) => void;
  onApplySuggestedVoice?: (voice: string) => void;
}) {
  const [saved, setSaved] = useState<SavedDirection[]>(loadSavedDirections);
  const parsed = useParsedDirection(value);

  const save = () => {
    const name = window.prompt("Nombre para este prompt de dirección:")?.trim();
    if (!name) return;
    const next = [...saved.filter((d) => d.name !== name), { name, text: value }];
    setSaved(next);
    storeSavedDirections(next);
  };

  const remove = (name: string) => {
    const next = saved.filter((d) => d.name !== name);
    setSaved(next);
    storeSavedDirections(next);
  };

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-fuchsia-400" />
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Prompt de dirección de voz</h3>
        </div>
        <button onClick={save} disabled={!value.trim()} className={chipButtonClass}>
          <Save className="w-3 h-3" /> Guardar
        </button>
      </div>

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {saved.map((d) => (
            <span key={d.name} className="flex items-center rounded-md bg-slate-950 border border-slate-800 text-[11px]">
              <button onClick={() => onChange(d.text)} className="px-2 py-1 text-slate-300 hover:text-white cursor-pointer">{d.name}</button>
              <button onClick={() => remove(d.name)} aria-label={`Eliminar ${d.name}`} className="pr-1.5 text-slate-600 hover:text-rose-400 cursor-pointer">
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_DIRECTION_CHARS}
        spellCheck={false}
        placeholder="Pega aquí el prompt de narración: tipo de voz, velocidad, estabilidad, estilo, reglas de pausas..."
        className="w-full min-h-[150px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
      />

      {parsed && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {directionSummary(parsed).map((chip) => (
              <span key={chip} className="px-2 py-0.5 rounded-full bg-fuchsia-950/50 border border-fuchsia-900/60 text-[10px] font-semibold text-fuchsia-200">{chip}</span>
            ))}
          </div>
          {parsed.suggestedVoice && onApplySuggestedVoice && (
            <button onClick={() => onApplySuggestedVoice(parsed.suggestedVoice!)} className={`${chipButtonClass} self-start text-slate-300`}>
              <Wand2 className="w-3 h-3" /> Usar voz sugerida: {parsed.suggestedVoice}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ModelPicker({ catalog, value, onChange }: { catalog: TtsCatalog | null; value: string; onChange: (model: string) => void }) {
  const models = catalog?.models ?? [];
  const isListed = models.some((m) => m.id === value);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const showCustom = customOpen || (!!catalog && !!value && !isListed);
  const nothingConfigured = catalog && !catalog.configured.openrouter && !catalog.configured.gemini;

  const commitCustom = () => {
    const id = customDraft.trim();
    if (id) onChange(id);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
          <Cpu className="w-3.5 h-3.5" /> Modelo
        </span>
        <select
          value={showCustom ? "__custom" : value}
          onChange={(e) => {
            if (e.target.value === "__custom") {
              setCustomDraft(isListed ? "" : value);
              setCustomOpen(true);
            } else {
              setCustomOpen(false);
              onChange(e.target.value);
            }
          }}
          className="min-w-0 max-w-[65%] bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
        >
          {!catalog && <option value={value}>Cargando…</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
          <option value="__custom">Otro modelo de OpenRouter…</option>
        </select>
      </label>
      {showCustom && (
        <input
          value={customOpen ? customDraft : value}
          onChange={(e) => {
            setCustomOpen(true);
            setCustomDraft(e.target.value);
          }}
          onBlur={commitCustom}
          onKeyDown={(e) => e.key === "Enter" && commitCustom()}
          placeholder="proveedor/modelo (p. ej. hexgrad/kokoro-82m) y Enter"
          className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
        />
      )}
      {nothingConfigured && (
        <p className="flex gap-1.5 text-[10px] text-amber-300">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" /> El servidor no tiene OPENROUTER_API_KEY configurada.
        </p>
      )}
    </div>
  );
}

export function VoiceCast({
  speakers,
  voices,
  onChange,
  available,
  header,
  children,
}: {
  speakers: string[];
  voices: Record<string, string>;
  onChange: (voices: Record<string, string>) => void;
  available: VoiceOption[];
  header?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={panelClass}>
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-fuchsia-400" />
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Reparto de voces</h3>
      </div>
      {header}
      {speakers.length === 0 && <p className="text-[11px] text-slate-500">Escribe un guion para detectar personajes.</p>}
      {speakers.map((speaker) => (
        <div key={speaker} className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-slate-200 truncate">{speaker}</span>
          {available.length ? (
            <select
              value={voices[speaker] || ""}
              onChange={(e) => onChange({ ...voices, [speaker]: e.target.value })}
              className="min-w-0 max-w-[65%] bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
            >
              {available.map((v) => (
                <option key={v.name} value={v.name}>{v.tone ? `${v.name} — ${v.tone}` : v.name}</option>
              ))}
            </select>
          ) : (
            <input
              value={voices[speaker] || ""}
              onChange={(e) => onChange({ ...voices, [speaker]: e.target.value.trim() })}
              placeholder="voz del modelo"
              className="w-40 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
            />
          )}
        </div>
      ))}
      {children}
    </div>
  );
}

export function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="text-xs font-bold text-slate-200 mt-1">{value}</div>
    </div>
  );
}
