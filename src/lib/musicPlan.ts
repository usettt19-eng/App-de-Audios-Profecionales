// Tramos de música de fondo a partir del guion: cada bloque con una indicación (MÚSICA: …) empieza un tramo
// nuevo con ese ambiente; los bloques sin indicación siguen con la música del tramo anterior.

export interface MusicCueSource {
  cues: { kind: string; description: string }[];
}

export interface PlannedTrack {
  startIndex: number;
  mood: string;
}

// Indicaciones que no describen un ambiente sino un efecto de montaje ("Fading out", "se apaga…").
const NOT_A_MOOD = /^(fad(e|ing)\s*(in|out)|se apaga|silencio|corte|stop)\b/i;

export function planMusicTracks(sections: MusicCueSource[], fallbackMood: string): PlannedTrack[] {
  const tracks: PlannedTrack[] = [];
  sections.forEach((section, i) => {
    const cue = section.cues.find((c) => /^M[UÚ]SICA$/i.test(c.kind) && !NOT_A_MOOD.test(c.description.trim()));
    if (cue) tracks.push({ startIndex: i, mood: cue.description.trim() });
    else if (i === 0) tracks.push({ startIndex: 0, mood: fallbackMood });
  });
  return tracks;
}

// Índice del tramo que suena en cada bloque (el último que empezó en ese bloque o antes).
export function trackForBlock(tracks: { startIndex: number }[], blockIndex: number): number {
  let current = 0;
  tracks.forEach((t, i) => {
    if (t.startIndex <= blockIndex) current = i;
  });
  return current;
}
