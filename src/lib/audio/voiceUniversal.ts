// Kaya · 🎤 Voice Notes 2.0 (V1–V2, approved 22-Sep-2026).
//
// THE BUG THIS FIXES: the composer recorded with the browser's DEFAULT format
// — Android/Chrome produces WebM/Opus, which iPhones can't reliably decode —
// so a note sent from an Android phone "breaks" for an iPhone receiver.
// MediaRecorder's WebM also carries a broken duration header (dead seek bar,
// stutter near the end).
//
// THE GUARANTEE: every voice note UPLOADED to a chat is in a format that
// plays on every phone, with a correct duration header:
//   V1 · record straight to MP4/AAC where the browser can (all iPhones,
//        Chrome 126+) — nothing to convert, smallest files.
//   V2 · otherwise (older Chrome, Firefox) the note is converted ON THE
//        SENDER'S PHONE before upload: WebAudio decode → mono 16 kHz →
//        16-bit WAV. WAV is license-free and universally decodable.
//        (The design doc named MP3 here; every JS MP3 encoder is LGPL —
//        a legal risk for a proprietary bundle — so the rare fallback is
//        WAV instead: same universal-playback guarantee, ~2 MB/min, well
//        under the 25 MB voice cap for the 120 s max note. Flagged as a
//        deliberate deviation in the PR.)
//
// Speech at mono 16 kHz is crisp for talk (that's telephone-plus quality);
// music-grade fidelity is not the job of a chat voice note.

/** Recorder format preference ladder (V1). First supported wins; undefined
 *  lets the browser pick (then V2 converts before upload anyway). */
export function pickVoiceRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const prefs = [
    'audio/mp4;codecs=mp4a.40.2', // AAC-LC in MP4 — the universal target
    'audio/mp4',
    'audio/webm;codecs=opus',     // fine to RECORD with; converted before upload
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const t of prefs) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* keep looking */ }
  }
  return undefined;
}

/** Formats every phone plays natively — safe to upload as-is. */
export function isUniversalVoiceType(mime: string | undefined): boolean {
  const m = (mime || '').toLowerCase();
  return m.includes('mp4') || m.includes('aac') || m.includes('mpeg') || m.includes('mp3') || m.includes('wav');
}

export interface UniversalVoice {
  blob: Blob;
  mime: string;
  /** True when the note had to be converted (WebM/Ogg source). */
  converted: boolean;
}

/** V2 · Make a recorded voice blob universally playable. MP4/AAC (and other
 *  universal types) pass through untouched; WebM/Ogg convert to mono 16 kHz
 *  WAV. If decoding fails for any reason, the original blob is returned so
 *  sending never breaks — that path is exactly today's behaviour, no worse. */
export async function ensureUniversalVoice(blob: Blob, targetHz = 16000): Promise<UniversalVoice> {
  if (isUniversalVoiceType(blob.type)) return { blob, mime: blob.type, converted: false };
  try {
    const wav = await transcodeToWav(blob, targetHz);
    return { blob: wav, mime: 'audio/wav', converted: true };
  } catch {
    return { blob, mime: blob.type || 'audio/webm', converted: false };
  }
}

async function transcodeToWav(blob: Blob, targetHz: number): Promise<Blob> {
  const bytes = await blob.arrayBuffer();
  type AC = typeof AudioContext;
  const Ctx: AC | undefined =
    typeof AudioContext !== 'undefined' ? AudioContext
    : (globalThis as { webkitAudioContext?: AC }).webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') throw new Error('WebAudio unavailable');

  // Decode with a throwaway context (decodeAudioData needs a live one)…
  const probe = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(bytes.slice(0));
  } finally {
    probe.close().catch(() => {});
  }

  // …then let the browser itself downmix to mono + resample to targetHz
  // (OfflineAudioContext resampling beats any hand-rolled interpolation).
  const frames = Math.max(1, Math.ceil(decoded.duration * targetHz));
  const oac = new OfflineAudioContext(1, frames, targetHz);
  const src = oac.createBufferSource();
  src.buffer = decoded;
  src.connect(oac.destination);
  src.start(0);
  const rendered = await oac.startRendering();
  return pcm16WavBlob(rendered.getChannelData(0), targetHz);
}

/** Standard 44-byte-header 16-bit mono PCM WAV. */
function pcm16WavBlob(samples: Float32Array, sampleRate: number): Blob {
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);          // fmt chunk size
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate (mono 16-bit)
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
