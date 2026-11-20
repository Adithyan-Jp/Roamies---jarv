// Malayalam, as an optional language to talk in. Parakeet (the Windows speech model) has no Malayalam, so when the
// language is set to ml-IN the voice helper records the take to a small WAV file instead of reading it, and this
// reads it with one of two engines the user picks:
//  - 'local': a whisper.cpp server on this computer (whisper-server with a Malayalam ggml model). The audio never
//    leaves the PC. Roamies starts the server itself when it's told where the program and the model are.
//  - 'gemini': Gemini, with the user's Google AI Studio key (the audio goes to Google).
// Nothing falls back from one to the other by itself: a take that can't be read locally is never sent to the cloud
// on the quiet. Spoken Malayalam replies need nothing here: Gemini's voice detects the language from the text.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GEMINI_API } from './gemini.mjs';

export const ML = 'ml-IN';
export const ML_ENGINES = ['local', 'gemini'];
// The Gemini text model that reads the clip (the same one Roamies already uses for Gemini chat).
export const ML_GEMINI_MODEL = 'gemini-3.8-flash';
export const ML_PORT = 8178;

const MALAYALAM = /[\u0D00-\u0D7F]/;
export const hasMalayalam = (s) => MALAYALAM.test(String(s ?? ''));

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ---------- the clip the voice helper leaves ----------

const CLIP = /^roamies-ml-\d+-\d+\.wav$/;
const MAX_CLIP = 12e6; // a take is at most a minute: about 2 MB of 16 kHz mono

/** Is this a WAV file (RIFF/WAVE header, and some audio after it)? */
export const isWav = (b) => Buffer.isBuffer(b) && b.length > 44 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE';

/** The helper's recording, read and deleted. Only a file it makes (by its name) is touched. */
export async function readClip(file) {
  const p = path.resolve(String(file ?? ''));
  if (!CLIP.test(path.basename(p))) throw fail('clip', 'That is not a recording of mine.');
  try {
    const b = await fs.readFile(p);
    if (b.length > MAX_CLIP || !isWav(b)) throw fail('clip', 'The recording was not a usable WAV file.');
    return b;
  } finally {
    fs.unlink(p).catch(() => {});
  }
}

// ---------- Gemini ----------

const PROMPT = 'Transcribe this speech exactly as spoken. It is Malayalam, and may have English words mixed in. Write the Malayalam in Malayalam script (never transliterated into English letters) and keep English words in English. Reply with the transcript only: no notes, no labels, no translation. If there is no speech, reply with nothing.';

export const geminiRequest = (wav, { model = ML_GEMINI_MODEL } = {}) => ({
  model,
  input: [
    { type: 'text', text: PROMPT },
    { type: 'audio', data: Buffer.from(wav).toString('base64'), mime_type: 'audio/wav' },
  ],
});

/** The text of a Gemini reply, whichever of its shapes it comes in (text parts; thoughts are skipped). */
export function outputText(j) {
  if (!j || typeof j !== 'object') return '';
  if (typeof j.output_text === 'string') return j.output_text.trim();
  const parts = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x !== 'object') return;
    if ((x.type === 'text' || x.type == null) && typeof x.text === 'string') parts.push(x.text);
    for (const k of ['outputs', 'output', 'content', 'parts', 'candidates']) walk(x[k]);
  };
  walk(j.outputs ?? j.output ?? j.candidates ?? j);
  return parts.join('').trim();
}

// Whisper writes "[BLANK_AUDIO]" or "(music)" for a take with no speech in it.
const NOISE = /[[(]\s*(music|noise|silence|blank_audio|applause|laughter)\s*[\])]/gi;
const tidy = (s) => String(s ?? '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

export async function transcribeGemini(wav, { key, model = ML_GEMINI_MODEL, fetchImpl = fetch, timeout = 25_000 } = {}) {
  let r;
  try {
    r = await fetchImpl(`${GEMINI_API}/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify(geminiRequest(wav, { model })),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw fail('network', `Couldn't reach Gemini (${e.name === 'TimeoutError' ? 'it took too long' : e.message}).`);
  }
  if (!r.ok) {
    const said = (await r.text().catch(() => '')).match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
    if (r.status === 401 || r.status === 403 || /API key/i.test(said ?? '')) throw fail('key', 'Gemini did not accept the key.', { status: r.status });
    if (r.status === 429) throw fail('rate', 'Gemini is rate limiting (the free allowance may be used up for now).', { status: r.status });
    throw fail('network', `Gemini: ${said ?? `error ${r.status}`}`, { status: r.status });
  }
  const j = await r.json().catch(() => null);
  return tidy(outputText(j));
}

// ---------- whisper.cpp server on this computer ----------

/** Send a clip to a whisper.cpp server (its /inference), or to an OpenAI-style one when the address ends in /v1. */
export async function transcribeLocal(wav, { url, fetchImpl = fetch, timeout = 60_000 } = {}) {
  const base = String(url ?? '').replace(/\/+$/, '');
  const openai = /\/v1$/.test(base);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('language', 'ml');
  form.append('response_format', 'json');
  if (openai) form.append('model', 'whisper-1'); else form.append('temperature', '0.0');
  let r;
  try {
    r = await fetchImpl(`${base}${openai ? '/audio/transcriptions' : '/inference'}`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw fail('local_down', `The Malayalam speech engine on this computer didn't answer (${e.name === 'TimeoutError' ? 'it took too long' : e.message}).`);
  }
  if (!r.ok) throw fail('local_down', `The Malayalam speech engine said error ${r.status}.`, { status: r.status });
  const j = await r.json().catch(() => null);
  return tidy(typeof j?.text === 'string' ? j.text : '');
}

// whisper-server is the program that ships with whisper.cpp; the model is a ggml Whisper file.
const SERVER_NAME = /^whisper[-_]?server(\.exe)?$/i;
const MODEL_FILE = /\.(bin|gguf)$/i;
const MIN_MODEL = 20e6;

/** Are the program and the model they point to usable? → { ok, why } (why is said to them as it is). */
export async function checkSetup({ exe, model } = {}) {
  if (!exe || !model) return { ok: false, why: 'Say where whisper-server and the Malayalam model are.' };
  if (!SERVER_NAME.test(path.basename(exe))) return { ok: false, why: 'That program should be whisper-server (from whisper.cpp).' };
  if (!MODEL_FILE.test(model)) return { ok: false, why: 'The Malayalam model should be a ggml .bin file.' };
  const size = async (f) => { try { const s = await fs.stat(f); return s.isFile() ? s.size : -1; } catch { return -1; } };
  if ((await size(exe)) < 0) return { ok: false, why: "I can't find whisper-server at that path." };
  if ((await size(model)) < MIN_MODEL) return { ok: false, why: "I can't find the Malayalam model at that path (or it isn't the whole file)." };
  return { ok: true, why: '' };
}

/** whisper-server run for Roamies: started when first needed, kept for the next takes, stopped when Roamies quits. */
export class LocalServer {
  constructor({ exe, model, port = ML_PORT, spawnImpl = spawn, fetchImpl = fetch, log = () => {}, wait = 120_000 }) {
    Object.assign(this, { exe, model, port, spawnImpl, fetchImpl, log, wait });
    this.url = `http://127.0.0.1:${port}`;
    this.child = null;
    this.starting = null;
  }

  async answering() {
    try { await this.fetchImpl(this.url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
  }

  /** Resolves once the server answers. */
  ensure() {
    if (this.starting) return this.starting;
    this.starting = this.start().catch((e) => { this.starting = null; throw e; });
    return this.starting;
  }

  async start() {
    if (this.child && this.child.exitCode == null) { if (await this.answering()) return; }
    this.child = null;
    const args = ['-m', this.model, '--host', '127.0.0.1', '--port', String(this.port), '-l', 'ml'];
    let err = '';
    const child = this.spawnImpl(this.exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, cwd: path.dirname(this.exe) });
    this.child = child;
    child.stderr?.on('data', (d) => { err = (err + d).slice(-600); });
    let gone = null;
    child.once('error', (e) => { gone = e.message; });
    child.once('exit', (code) => { gone = `it stopped (exit ${code})`; this.child = null; this.starting = null; });
    const t0 = Date.now();
    while (Date.now() - t0 < this.wait) {
      if (gone) throw fail('local_down', `The Malayalam speech engine didn't start: ${gone}.${err ? ` ${err.trim().split('\n').pop()}` : ''}`);
      if (await this.answering()) { this.log(`whisper-server ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return; }
      await new Promise((r) => setTimeout(r, 400));
    }
    this.stop();
    throw fail('local_down', "The Malayalam speech engine took too long to start.");
  }

  stop() {
    try { this.child?.kill(); } catch {}
    this.child = null;
    this.starting = null;
  }
}

// ---------- the one the app uses ----------

/**
 * config(): { mlEngine, mlServer, mlModel, mlUrl }; geminiKey(): the AI Studio key or null.
 * hear(wav) → the words, or throws an error whose code says what to tell them:
 * 'setup' (the local engine isn't set up), 'key' (no Gemini key, or not accepted), 'rate', 'network', 'local_down'.
 */
export function createEars({ config, geminiKey, fetchImpl = fetch, makeServer = (o) => new LocalServer(o), check = checkSetup, log = () => {} }) {
  let server = null, serverFor = '';
  const engine = () => (ML_ENGINES.includes(config().mlEngine) ? config().mlEngine : 'local');
  return {
    engine,
    async hear(wav) {
      const c = config();
      if (engine() === 'gemini') {
        const key = await geminiKey();
        if (!key) throw fail('key', 'There is no Gemini key to read Malayalam with.');
        return transcribeGemini(wav, { key, fetchImpl });
      }
      // Local: a server Roamies starts from the program and model they chose, else a server they run themselves.
      if (c.mlServer || c.mlModel) {
        const s = await check({ exe: c.mlServer, model: c.mlModel });
        if (!s.ok) throw fail('setup', s.why);
        const sig = `${c.mlServer}|${c.mlModel}`;
        if (!server || serverFor !== sig) { server?.stop(); server = makeServer({ exe: c.mlServer, model: c.mlModel, log, fetchImpl }); serverFor = sig; }
        await server.ensure();
        return transcribeLocal(wav, { url: server.url, fetchImpl });
      }
      if (c.mlUrl) return transcribeLocal(wav, { url: c.mlUrl, fetchImpl });
      throw fail('setup', 'The Malayalam speech engine on this computer is not set up yet.');
    },
    /** Their program and model, as they last were: what the panel shows. */
    async status() {
      const c = config();
      if (engine() === 'gemini') return { engine: 'gemini', ready: !!(await geminiKey()), note: '' };
      if (c.mlServer || c.mlModel) { const s = await check({ exe: c.mlServer, model: c.mlModel }); return { engine: 'local', ready: s.ok, note: s.why }; }
      return { engine: 'local', ready: !!c.mlUrl, note: c.mlUrl ? '' : 'Not set up yet.' };
    },
    stop() { server?.stop(); server = null; },
  };
}
