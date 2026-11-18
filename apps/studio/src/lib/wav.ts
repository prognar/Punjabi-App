/* Recording clean-up, ported from the prototype: mono, 22.05 kHz, silence trimmed, quiet takes evened out, 16-bit WAV.
   WAV plays everywhere (Android records WebM, which older iPhones can't play). The DSP parts are pure and unit-tested. */
export const RATE = 22050;

/** Trim silence from both ends, keeping `padS` seconds of lead-in / tail. */
export function trimSilence(d: Float32Array, rate = RATE, padS = 0.12): Float32Array {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = Math.max(0.02, peak * 0.08), pad = Math.round(padS * rate);
  let a = 0, b = d.length - 1;
  while (a < d.length && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  return b > a ? d.subarray(Math.max(0, a - pad), Math.min(d.length, b + pad + 1)) : d;
}
export function peakOf(d: Float32Array) { let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); return p; }

/** 16-bit PCM mono WAV. Quiet takes (peak < 0.5) are raised to a 0.9 peak. */
export function encodeWav(d: Float32Array, rate = RATE): ArrayBuffer {
  const peak = peakOf(d), gain = peak > 0 && peak < 0.5 ? 0.9 / peak : 1;
  const v = new DataView(new ArrayBuffer(44 + d.length * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, d[i] * gain)) * 0x7fff), true);
  return v.buffer;
}

export interface Take { blob: Blob; url: string; durationMs: number; tooQuiet: boolean }

/** Any recording → cleaned WAV. Falls back to the original blob if the browser can't decode it. */
export async function toWav(blob: Blob): Promise<Take> {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    ac.close?.();
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * RATE)), RATE);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const d = trimSilence((await off.startRendering()).getChannelData(0));
    const wav = new Blob([encodeWav(d)], { type: 'audio/wav' });
    return { blob: wav, url: URL.createObjectURL(wav), durationMs: Math.round((d.length / RATE) * 1000), tooQuiet: peakOf(d) < 0.03 };
  } catch {
    return { blob, url: URL.createObjectURL(blob), durationMs: 0, tooQuiet: false };
  }
}

/** Start recording from the microphone. Call the returned stop() to finish; stops by itself after maxMs. */
export async function startRecording(maxMs = 12000): Promise<{ stop: () => void; done: Promise<Take> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } as MediaTrackConstraints });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Take>(resolve => {
    rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve(toWav(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))); };
  });
  rec.start();
  const timer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, maxMs);
  return { stop: () => { clearTimeout(timer); if (rec.state === 'recording') rec.stop(); }, done };
}
