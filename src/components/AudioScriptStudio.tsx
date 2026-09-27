import React, { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Download, FileUp, Loader2, Sparkles, Users, Clock, Layers, AlertCircle } from "lucide-react";
import { buildRenderPlan, estimateDurationSeconds, listSpeakers, parseScript } from "../lib/scriptParser";
import { engineForModel } from "../lib/ttsModels";
import {
  chipButtonClass, DirectionPanel, formatDuration, ModelPicker, panelClass, Stat, useParsedDirection, useTtsCatalog, VoiceCast, voicesForModel, withDefaultVoices,
} from "./voiceControls";

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

export default function AudioScriptStudio() {
  const [script, setScript] = useState<string>(TEMPLATES[0].script);
  const [direction, setDirection] = useState<string>(TEMPLATES[0].style);
  const [voices, setVoices] = useState<Record<string, string>>({});
  const catalog = useTtsCatalog();
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const model = chosenModel ?? catalog?.defaultModel ?? "";
  const available = voicesForModel(catalog, model);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedDirection = useParsedDirection(direction);
  const segments = useMemo(
    () =>
      parseScript(script, {
        defaultPauseMs: parsedDirection?.defaultPauseMs,
        pauseAfterNumbersMs: parsedDirection?.pauseAfterNumbersMs,
      }),
    [script, parsedDirection]
  );
  const speakers = useMemo(() => listSpeakers(segments), [segments]);
  // OpenRouter genera una voz por solicitud; Gemini directo, hasta dos.
  const blockCount = useMemo(
    () => buildRenderPlan(segments, engineForModel(model) === "openrouter" ? { maxSpeakersPerBlock: 1, maxBlockChars: 3000 } : {}).filter((s) => s.type === "block").length,
    [segments, model]
  );
  const lineCount = segments.filter((s) => s.type === "line").length;
  const pauseCount = segments.filter((s) => s.type === "pause").length;
  const estimatedSeconds = estimateDurationSeconds(segments) * (100 / (parsedDirection?.speedPercent || 100));

  useEffect(() => {
    setVoices((prev) => withDefaultVoices(prev, speakers, parsedDirection?.suggestedVoice, available));
  }, [speakers, available]); // La voz sugerida solo se usa para personajes nuevos, no al editar el prompt.

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
        body: JSON.stringify({ script, voices, direction, model }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status} al generar el audio.`);
      }
      setAudioUrl(URL.createObjectURL(await res.blob()));
    } catch (err: any) {
      setError(err.message || "No se pudo generar el audio.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className={`lg:col-span-7 ${panelClass}`}>
        <div className="flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-fuchsia-400" />
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Guion</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button key={t.label} onClick={() => { setScript(t.script); setDirection(t.style); }} className={chipButtonClass}>
              {t.label}
            </button>
          ))}
          <button onClick={() => fileInputRef.current?.click()} className={chipButtonClass}>
            <FileUp className="w-3 h-3" /> Cargar .txt
          </button>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.fountain,text/plain" className="hidden" onChange={handleFile} />
        </div>

        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[360px] bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none focus:border-fuchsia-500/60 resize-y"
          placeholder="PERSONAJE (acotación): Texto a locutar..."
        />
        <FormatHelp />
      </div>

      <div className="lg:col-span-5 flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<Users className="w-3.5 h-3.5" />} label="Voces" value={String(speakers.length)} />
          <Stat icon={<Layers className="w-3.5 h-3.5" />} label="Líneas" value={`${lineCount} · ${pauseCount} pausas`} />
          <Stat icon={<Clock className="w-3.5 h-3.5" />} label="Duración est." value={formatDuration(estimatedSeconds)} />
        </div>

        <DirectionPanel
          value={direction}
          onChange={setDirection}
          onApplySuggestedVoice={
            available.some((v) => v.name === parsedDirection?.suggestedVoice) ? (voice) => setVoices(Object.fromEntries(speakers.map((sp) => [sp, voice]))) : undefined
          }
        />

        <VoiceCast
          speakers={speakers}
          voices={voices}
          onChange={setVoices}
          available={available}
          header={<ModelPicker catalog={catalog} value={model} onChange={setChosenModel} />}
        >
          <button
            onClick={handleGenerate}
            disabled={loading || !lineCount}
            className="mt-1 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 bg-fuchsia-600 text-white hover:bg-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? `Generando ${blockCount} bloque(s)...` : "Generar audio"}
          </button>
          {error && <ErrorNote message={error} />}
        </VoiceCast>

        {audioUrl && (
          <div className={panelClass}>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Resultado</h3>
            <audio controls src={audioUrl} className="w-full" />
            <a href={audioUrl} download="locucion.wav" className={`${chipButtonClass} justify-center py-2 text-slate-200`}>
              <Download className="w-4 h-4" /> Descargar WAV
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex gap-2 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md p-2">
      <AlertCircle className="w-4 h-4 shrink-0" /> {message}
    </div>
  );
}

export function FormatHelp() {
  return (
    <div className="text-[11px] text-slate-500 leading-relaxed">
      <span className="font-bold text-slate-400">Formato:</span>{" "}
      <code className="text-fuchsia-300">PERSONAJE: texto</code> ·{" "}
      <code className="text-fuchsia-300">PERSONAJE (tono): texto</code> ·{" "}
      <code className="text-fuchsia-300">(susurrando)</code> acotación en línea ·{" "}
      <code className="text-fuchsia-300">[PAUSA 1.5s]</code> silencio ·{" "}
      <code className="text-fuchsia-300"># comentario</code> se ignora. Las líneas sin personaje continúan al anterior.
    </div>
  );
}
