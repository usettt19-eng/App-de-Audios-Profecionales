import React, { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Download, FileUp, Loader2, Mic, Sparkles, Users, Clock, Layers, AlertCircle, SlidersHorizontal, Save, Trash2, Wand2 } from "lucide-react";
import { buildRenderPlan, estimateDurationSeconds, listSpeakers, parseScript } from "../lib/scriptParser";
import { directionSummary, MAX_DIRECTION_CHARS, parseVoiceDirection } from "../lib/voiceDirection";

const VOICES: { name: string; tone: string }[] = [
  { name: "Kore", tone: "Firme" },
  { name: "Charon", tone: "Informativa" },
  { name: "Puck", tone: "Animada" },
  { name: "Zephyr", tone: "Brillante" },
  { name: "Aoede", tone: "Fresca" },
  { name: "Fenrir", tone: "Enérgica" },
  { name: "Leda", tone: "Juvenil" },
  { name: "Orus", tone: "Firme" },
  { name: "Callirrhoe", tone: "Relajada" },
  { name: "Autonoe", tone: "Brillante" },
  { name: "Enceladus", tone: "Susurrante" },
  { name: "Iapetus", tone: "Clara" },
  { name: "Umbriel", tone: "Relajada" },
  { name: "Algieba", tone: "Suave" },
  { name: "Despina", tone: "Suave" },
  { name: "Erinome", tone: "Clara" },
  { name: "Algenib", tone: "Grave" },
  { name: "Rasalgethi", tone: "Informativa" },
  { name: "Laomedeia", tone: "Animada" },
  { name: "Achernar", tone: "Suave" },
  { name: "Alnilam", tone: "Firme" },
  { name: "Schedar", tone: "Equilibrada" },
  { name: "Gacrux", tone: "Madura" },
  { name: "Pulcherrima", tone: "Directa" },
  { name: "Achird", tone: "Amigable" },
  { name: "Zubenelgenubi", tone: "Casual" },
  { name: "Vindemiatrix", tone: "Gentil" },
  { name: "Sadachbia", tone: "Vivaz" },
  { name: "Sadaltager", tone: "Experta" },
  { name: "Sulafat", tone: "Cálida" },
];

const DEFAULT_VOICE_ROTATION = ["Charon", "Kore", "Puck", "Aoede", "Algenib", "Leda", "Sulafat", "Iapetus"];

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

const TEMPLATES: { label: string; style: string; script: string }[] = [
  {
    label: "Documental",
    style: `Voz: masculina, adulta, 35-50 años, tono grave/cálido de documental (referencia: narrador de National Geographic en español latino, NO tono infantil ni comercial/entusiasta).

Configuración:
- Estabilidad: alta (0.65-0.75) para evitar variaciones emocionales bruscas
- Velocidad: 90-95% de la velocidad normal (ritmo pausado, deliberado)
- Estilo/exageración: baja - la voz no debe sonar "vendedora", sino informativa y levemente solemne, como revelando un secreto
- Pausas: añade [pausa] de 0.5s después de cada dato numérico o afirmación de escala`,
    script: `En lo más profundo del océano Pacífico existe un lugar donde la luz del sol nunca ha llegado.
La fosa de las Marianas alcanza casi 11 mil metros de profundidad. Allí, la presión es mil veces mayor que en la superficie.
Y, sin embargo, hay vida.
[pausa]
Criaturas que brillan en la oscuridad, que no necesitan el sol, que han sobrevivido durante millones de años sin que nadie las viera.`,
  },
  {
    label: "Anuncio institucional",
    style: "Tono institucional, cálido y confiable, ritmo pausado.",
    script: `# SPOT: Matrículas abiertas 2027 — duración aprox. 40 s
LOCUTOR (cálido, cercano): En nuestro colegio creemos que cada estudiante tiene un talento único.
[PAUSA 0.5s]
DIRECTORA (orgullosa): Por eso, este año abrimos nuevos laboratorios de ciencia y robótica, y ampliamos nuestro programa bilingüe.
LOCUTOR: Las matrículas para el período 2027 ya están abiertas.
Agenda tu visita guiada y conoce a nuestro equipo docente.
[PAUSA 1s]
LOCUTOR (enfático): Colegio San Martín. Educamos para el futuro.`,
  },
  {
    label: "Podcast educativo",
    style: "Conversación natural y dinámica entre dos presentadores de podcast.",
    script: `# EPISODIO 12 — El ciclo del agua
ANA (entusiasta): ¡Hola a todos y bienvenidos a Ciencia en Casa! Hoy hablamos del ciclo del agua.
MARCOS: Así es, Ana. ¿Sabían que el agua que beben hoy pudo haber caído como lluvia hace millones de años?
ANA (sorprendida): ¡Increíble! Empecemos por la evaporación.
MARCOS (explicativo): Cuando el sol calienta mares y ríos, el agua se convierte en vapor y sube a la atmósfera.
[PAUSA]
ANA: Y ahí arriba se enfría y forma las nubes. Eso se llama condensación.
MARCOS (riendo): ¡Exacto! Y cuando las nubes ya no pueden más... llega la precipitación.`,
  },
  {
    label: "Comunicado a familias",
    style: "Formal, claro y sereno.",
    script: `NARRADORA (serena): Estimadas familias, les recordamos que el próximo lunes no habrá clases por jornada de capacitación docente.
[PAUSA 0.7s]
Las actividades se reanudarán con normalidad el martes a las 7:30 de la mañana.
Para cualquier consulta, comuníquense con secretaría. Muchas gracias.`,
  },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

export default function AudioScriptStudio() {
  const [script, setScript] = useState<string>(TEMPLATES[0].script);
  const [direction, setDirection] = useState<string>(TEMPLATES[0].style);
  const [savedDirections, setSavedDirections] = useState<SavedDirection[]>(loadSavedDirections);
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedDirection = useMemo(() => (direction.trim() ? parseVoiceDirection(direction) : undefined), [direction]);
  const segments = useMemo(
    () =>
      parseScript(script, {
        defaultPauseMs: parsedDirection?.defaultPauseMs,
        pauseAfterNumbersMs: parsedDirection?.pauseAfterNumbersMs,
      }),
    [script, parsedDirection]
  );
  const pauseCount = segments.filter((s) => s.type === "pause").length;
  const estimatedSeconds = Math.round(estimateDurationSeconds(segments) * (100 / (parsedDirection?.speedPercent || 100)));
  const speakers = useMemo(() => listSpeakers(segments), [segments]);
  const blockCount = useMemo(() => buildRenderPlan(segments).filter((s) => s.type === "block").length, [segments]);
  const lineCount = segments.filter((s) => s.type === "line").length;

  // Asigna una voz por defecto a cada personaje nuevo sin pisar las elecciones del usuario.
  useEffect(() => {
    setVoices((prev) => {
      const next = { ...prev };
      let changed = false;
      speakers.forEach((speaker, i) => {
        if (!next[speaker]) {
          // El primer personaje toma la voz sugerida por el prompt de dirección, si la hay.
          next[speaker] = i === 0 && parsedDirection?.suggestedVoice ? parsedDirection.suggestedVoice : DEFAULT_VOICE_ROTATION[i % DEFAULT_VOICE_ROTATION.length];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [speakers]);

  const applySuggestedVoice = () => {
    const voice = parsedDirection?.suggestedVoice;
    if (voice) setVoices((prev) => Object.fromEntries([...Object.keys(prev), ...speakers].map((sp) => [sp, voice])));
  };

  const saveDirection = () => {
    const name = window.prompt("Nombre para este prompt de dirección:")?.trim();
    if (!name) return;
    const next = [...savedDirections.filter((d) => d.name !== name), { name, text: direction }];
    setSavedDirections(next);
    storeSavedDirections(next);
  };

  const deleteDirection = (name: string) => {
    const next = savedDirections.filter((d) => d.name !== name);
    setSavedDirections(next);
    storeSavedDirections(next);
  };

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScript(await file.text());
    e.target.value = "";
  };

  const handleGenerate = async () => {
    if (!lineCount || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/script-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, voices, direction }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status} al generar el audio.`);
      }
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setError(err.message || "No se pudo generar el audio.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="audio-script-studio" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Editor de guion */}
      <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AudioLines className="w-4 h-4 text-fuchsia-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Guion</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                onClick={() => { setScript(t.script); setDirection(t.style); }}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 cursor-pointer"
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center gap-1 cursor-pointer"
            >
              <FileUp className="w-3 h-3" /> Cargar .txt
            </button>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.fountain,text/plain" className="hidden" onChange={handleFile} />
          </div>
        </div>

        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[360px] bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          placeholder="PERSONAJE (acotación): Texto a locutar..."
        />

        <div className="text-[11px] text-slate-500 leading-relaxed">
          <span className="font-bold text-slate-400">Formato:</span>{" "}
          <code className="text-fuchsia-300">PERSONAJE: texto</code> ·{" "}
          <code className="text-fuchsia-300">PERSONAJE (tono): texto</code> ·{" "}
          <code className="text-fuchsia-300">(susurrando)</code> acotación en línea ·{" "}
          <code className="text-fuchsia-300">[PAUSA 1.5s]</code> silencio ·{" "}
          <code className="text-fuchsia-300"># comentario</code> se ignora. Las líneas sin personaje continúan al anterior.
        </div>
      </div>

      {/* Panel de reparto y generación */}
      <div className="lg:col-span-5 flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Users className="w-3.5 h-3.5" />} label="Voces" value={String(speakers.length)} />
          <Stat icon={<Layers className="w-3.5 h-3.5" />} label="Líneas" value={`${lineCount} · ${pauseCount} pausas`} />
          <Stat icon={<Clock className="w-3.5 h-3.5" />} label="Duración est." value={formatDuration(estimatedSeconds)} />
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-fuchsia-400" />
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Prompt de dirección de voz</h3>
            </div>
            <button
              onClick={saveDirection}
              disabled={!direction.trim()}
              className="px-2 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <Save className="w-3 h-3" /> Guardar
            </button>
          </div>

          {savedDirections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {savedDirections.map((d) => (
                <span key={d.name} className="flex items-center rounded-md bg-slate-950 border border-slate-800 text-[11px]">
                  <button onClick={() => setDirection(d.text)} className="px-2 py-1 text-slate-300 hover:text-white cursor-pointer">{d.name}</button>
                  <button onClick={() => deleteDirection(d.name)} aria-label={`Eliminar ${d.name}`} className="pr-1.5 text-slate-600 hover:text-rose-400 cursor-pointer">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            maxLength={MAX_DIRECTION_CHARS}
            spellCheck={false}
            placeholder="Pega aquí el prompt de narración: tipo de voz, velocidad, estabilidad, estilo, reglas de pausas..."
            className="w-full min-h-[150px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          />

          {parsedDirection && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {directionSummary(parsedDirection).map((chip) => (
                  <span key={chip} className="px-2 py-0.5 rounded-full bg-fuchsia-950/50 border border-fuchsia-900/60 text-[10px] font-semibold text-fuchsia-200">{chip}</span>
                ))}
              </div>
              {parsedDirection.suggestedVoice && (
                <button
                  onClick={applySuggestedVoice}
                  className="self-start px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-950 border border-slate-800 text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <Wand2 className="w-3 h-3" /> Usar voz sugerida: {parsedDirection.suggestedVoice}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-fuchsia-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Reparto de voces</h3>
          </div>
          {speakers.length === 0 && <p className="text-[11px] text-slate-500">Escribe un guion para detectar personajes.</p>}
          {speakers.map((speaker) => (
            <div key={speaker} className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-200 truncate">{speaker}</span>
              <select
                value={voices[speaker] || ""}
                onChange={(e) => setVoices((v) => ({ ...v, [speaker]: e.target.value }))}
                className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500/60"
              >
                {VOICES.map((v) => (
                  <option key={v.name} value={v.name}>{v.name} — {v.tone}</option>
                ))}
              </select>
            </div>
          ))}

          <button
            onClick={handleGenerate}
            disabled={loading || !lineCount}
            className="mt-1 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? `Generando ${blockCount} bloque(s)...` : "Generar audio"}
          </button>

          {error && (
            <div className="flex gap-2 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md p-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        {audioUrl && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Resultado</h3>
            <audio controls src={audioUrl} className="w-full" />
            <a
              href={audioUrl}
              download="locucion.wav"
              className="px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 text-slate-200 hover:border-slate-700"
            >
              <Download className="w-4 h-4" /> Descargar WAV
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500 text-[10px] font-bold uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="text-xs font-bold text-slate-200 mt-1">{value}</div>
    </div>
  );
}
