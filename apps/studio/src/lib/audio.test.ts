import { describe, expect, it } from 'vitest';
import { autoMode, plan, type VoiceLike } from '@punjabi-app/core';
import { RATE, encodeWav, trimSilence } from './wav';

const V = (lang: string, name = lang): VoiceLike => ({ lang, name, voiceURI: name, localService: true });
const ball = { pa: 'ਗੇਂਦ', rom: 'gaind' };

describe('voice plan', () => {
  it('uses a Punjabi voice when the device has one, then Hindi, then English', () => {
    const p = plan(ball, [V('pa-IN'), V('hi-IN'), V('en-US')]);
    expect(p.map(t => t.lang)).toEqual(['pa-IN', 'hi-IN', 'pa-IN', 'en-US', 'en-US']);
    expect(p[0].text).toBe('ਗੇਂਦ');
    expect(p[1].text).toBe('गेंद');
  });
  it('without Punjabi or Hindi voices, an English voice reads the sounds-like spelling', () => {
    const p = plan(ball, [V('en-GB')]);
    expect(p[0]).toMatchObject({ text: 'gaind', lang: 'en-US' });
    expect(autoMode([V('en-GB')])).toBe('en');
  });
  it('"say it as" in English letters is what the English voice reads', () => {
    const p = plan({ ...ball, speakAs: 'guy-nd', voice: 'en' }, [V('pa-IN'), V('en-US')]);
    expect(p[0]).toMatchObject({ text: 'guynd', lang: 'en-US' });
  });
  it('"say it as" in Gurmukhi replaces the card text for the Punjabi voice', () => {
    expect(plan({ ...ball, speakAs: 'ਗੈਂਦ' }, [V('pa-IN')])[0].text).toBe('ਗੈਂਦ');
  });
  it('forcing a voice the device lacks falls back sensibly', () => {
    expect(plan({ ...ball, voice: 'hi' }, [V('pa-IN')])[0].lang).toBe('pa-IN');
    expect(plan({ ...ball, voice: 'pa' }, [V('en-US')])[0].lang).toBe('en-US');
  });
  it('only the first alternative is spoken', () => {
    expect(plan({ pa: 'ਹਾਂ / ਹਾਂ ਜੀ', rom: 'haan / haan jee' }, [V('en-US')])[0].text).toBe('haan');
  });
});

describe('wav', () => {
  it('trims silence but keeps a little padding', () => {
    const d = new Float32Array(RATE * 2);
    for (let i = RATE * 0.8; i < RATE * 1.2; i++) d[i] = Math.sin(i / 5) * 0.6;
    const t = trimSilence(d);
    const s = t.length / RATE;
    expect(s).toBeGreaterThan(0.4); expect(s).toBeLessThan(0.7);
  });
  it('writes a valid 16-bit mono WAV header and evens out quiet takes', () => {
    const d = new Float32Array([0, 0.1, -0.1, 0.05]);
    const v = new DataView(encodeWav(d));
    const str = (o: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));
    expect([str(0, 4), str(8, 4), str(12, 4), str(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(1); expect(v.getUint32(24, true)).toBe(RATE); expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(Math.round(0.9 * 0x7fff)); // 0.1 peak raised to 0.9
  });
});
