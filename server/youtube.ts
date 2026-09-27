// Datos de un canal de YouTube para el análisis de formato (YouTube Data API v3, requiere YOUTUBE_API_KEY).

export interface ChannelRef {
  kind: "handle" | "id" | "username" | "custom";
  value: string;
}

export interface ChannelVideo {
  titulo: string;
  duracionSeg: number;
  vistas: number;
  fecha: string;
}

export interface ChannelData {
  nombre: string;
  handle?: string;
  suscriptores?: number;
  totalVideos?: number;
  descripcion: string;
  masVistos: ChannelVideo[];
  recientes: ChannelVideo[];
}

const API = "https://www.googleapis.com/youtube/v3";

// Reconoce enlaces y referencias a canales: youtube.com/@x, /channel/UC..., /user/x, /c/x, "@x" o un id "UC...".
export function parseChannelRef(input: string): ChannelRef | null {
  const text = input.trim();
  const url = text.match(/youtube\.com\/(@[\w.-]+|channel\/(UC[\w-]{22})|user\/([\w.-]+)|c\/([\w.-]+))/i);
  if (url) {
    if (url[2]) return { kind: "id", value: url[2] };
    if (url[3]) return { kind: "username", value: url[3] };
    if (url[4]) return { kind: "custom", value: url[4] };
    return { kind: "handle", value: url[1] };
  }
  if (/^@[\w.-]+$/.test(text)) return { kind: "handle", value: text };
  if (/^UC[\w-]{22}$/.test(text)) return { kind: "id", value: text };
  return null;
}

// "PT1H2M3S" -> 3723
export function isoDurationToSeconds(iso: string): number {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function compact(n?: number): string {
  if (n === undefined) return "?";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

async function get(doFetch: typeof fetch, path: string, params: Record<string, string>, key: string): Promise<any> {
  const query = new URLSearchParams({ ...params, key });
  const res = await doFetch(`${API}/${path}?${query}`);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube API (${res.status}): ${data?.error?.message || res.statusText}`);
  return data;
}

async function videoDetails(doFetch: typeof fetch, ids: string[], key: string): Promise<ChannelVideo[]> {
  if (!ids.length) return [];
  const data = await get(doFetch, "videos", { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: "50" }, key);
  return (data.items ?? []).map((v: any) => ({
    titulo: v.snippet?.title ?? "",
    duracionSeg: isoDurationToSeconds(v.contentDetails?.duration ?? ""),
    vistas: Number(v.statistics?.viewCount) || 0,
    fecha: (v.snippet?.publishedAt ?? "").slice(0, 10),
  }));
}

export async function fetchChannelData(ref: ChannelRef, key: string, doFetch: typeof fetch = fetch): Promise<ChannelData> {
  const part = "snippet,statistics,contentDetails";
  let channel: any;
  if (ref.kind === "custom") {
    const found = await get(doFetch, "search", { part: "snippet", type: "channel", q: ref.value, maxResults: "1" }, key);
    const id = found.items?.[0]?.snippet?.channelId ?? found.items?.[0]?.id?.channelId;
    if (id) channel = (await get(doFetch, "channels", { part, id }, key)).items?.[0];
  } else {
    const param: Record<string, string> =
      ref.kind === "handle" ? { forHandle: ref.value } : ref.kind === "id" ? { id: ref.value } : { forUsername: ref.value };
    channel = (await get(doFetch, "channels", { part, ...param }, key)).items?.[0];
  }
  if (!channel) throw new Error("No se encontró ese canal en YouTube.");

  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const recentIds: string[] = uploads
    ? ((await get(doFetch, "playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "25" }, key)).items ?? []).map(
        (i: any) => i.contentDetails?.videoId
      )
    : [];
  const topIds: string[] = ((await get(doFetch, "search", { part: "id", channelId: channel.id, type: "video", order: "viewCount", maxResults: "25" }, key)).items ?? []).map(
    (i: any) => i.id?.videoId
  );

  return {
    nombre: channel.snippet?.title ?? "",
    handle: channel.snippet?.customUrl,
    suscriptores: Number(channel.statistics?.subscriberCount) || undefined,
    totalVideos: Number(channel.statistics?.videoCount) || undefined,
    descripcion: (channel.snippet?.description ?? "").slice(0, 600),
    masVistos: await videoDetails(doFetch, topIds.filter(Boolean), key),
    recientes: await videoDetails(doFetch, recentIds.filter(Boolean), key),
  };
}

// Resumen compacto para el prompt de análisis.
export function channelDataToText(data: ChannelData): string {
  const row = (v: ChannelVideo) => `- "${v.titulo}" | ${clock(v.duracionSeg)} | ${compact(v.vistas)} vistas | ${v.fecha}`;
  return [
    `Canal: ${data.nombre}${data.handle ? ` (${data.handle})` : ""} — ${compact(data.suscriptores)} suscriptores — ${data.totalVideos ?? "?"} videos`,
    data.descripcion ? `Descripción: ${data.descripcion.replace(/\s+/g, " ")}` : "",
    "",
    `Videos más vistos (${data.masVistos.length}):`,
    ...data.masVistos.map(row),
    "",
    `Videos más recientes (${data.recientes.length}):`,
    ...data.recientes.map(row),
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
}
