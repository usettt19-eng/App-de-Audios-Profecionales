// Utilidades de audio: todo el ensamblado se hace en PCM lineal de 16 bits, mono, a 24 kHz.

export const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;

export function silence(ms: number): Buffer {
  return Buffer.alloc(Math.round((SAMPLE_RATE * ms) / 1000) * BYTES_PER_SAMPLE);
}

export function pcmDurationSeconds(pcmBytes: number): number {
  return pcmBytes / (SAMPLE_RATE * BYTES_PER_SAMPLE);
}

export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface WavInfo {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Buffer;
}

function parseWav(buf: Buffer): WavInfo {
  let offset = 12;
  let fmt: Omit<WavInfo, "data"> | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    let size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE: el formato real está en el subformato.
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24);
      fmt = { format, channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bitsPerSample: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      // Algunos servidores en streaming escriben un tamaño 0 o 0xFFFFFFFF: se toma hasta el final.
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      if (!fmt) throw new Error("WAV sin cabecera de formato.");
      return { ...fmt, data: buf.subarray(body, body + size) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV sin datos de audio.");
}

// Convierte cualquier WAV PCM (8/16/24/32 bits o float, mono o estéreo, cualquier frecuencia) a PCM 16 bits mono 24 kHz.
export function wavToPcm(buf: Buffer): Buffer {
  const wav = parseWav(buf);
  const bytes = wav.bitsPerSample / 8;
  const frameSize = bytes * wav.channels;
  const frames = Math.floor(wav.data.length / frameSize);

  const read = (pos: number): number => {
    if (wav.format === 3 && bytes === 4) return wav.data.readFloatLE(pos);
    if (bytes === 1) return (wav.data.readUInt8(pos) - 128) / 128;
    if (bytes === 2) return wav.data.readInt16LE(pos) / 32768;
    if (bytes === 3) return wav.data.readIntLE(pos, 3) / 8388608;
    if (bytes === 4) return wav.data.readInt32LE(pos) / 2147483648;
    throw new Error(`Formato WAV no soportado (${wav.bitsPerSample} bits).`);
  };
  if (wav.format !== 1 && wav.format !== 3) throw new Error(`Formato WAV no soportado (código ${wav.format}).`);

  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < wav.channels; c++) sum += read(f * frameSize + c * bytes);
    mono[f] = sum / wav.channels;
  }

  const ratio = wav.sampleRate / SAMPLE_RATE;
  const outFrames = Math.floor(frames / ratio);
  const out = Buffer.alloc(outFrames * BYTES_PER_SAMPLE);
  for (let i = 0; i < outFrames; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, frames - 1);
    const value = mono[i0] + (mono[i1] - mono[i0]) * (pos - i0);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), i * BYTES_PER_SAMPLE);
  }
  return out;
}

export function isWav(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
}

export function isMp3(buf: Buffer): boolean {
  return buf.toString("ascii", 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
}
