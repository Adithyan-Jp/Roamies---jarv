// Malayalam as an optional language: the font that draws it, reading a recorded take with the engine the user picked
// (a whisper.cpp server on this computer, or Gemini), never sending a take to the cloud on the quiet, and Malayalam
// text going through the voice's sentence and cue handling. Run: npm test
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GeminiVoice, plain, speechRequest } from '../gemini.mjs';
import { SpeechText } from '../speech.mjs';
import { LocalServer, ML, ML_ENGINES, checkSetup, createEars, geminiRequest, hasMalayalam, isWav, outputText, readClip, transcribeGemini, transcribeLocal } from '../malayalam.mjs';

const showcase = new URL('../../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, showcase), 'utf8');
const readRepo = (p) => fs.readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

// ---- the font: bundled with its licence and credit, declared in every page that shows text, and in every stack ----
assert.ok(fs.statSync(new URL('onboarding/fonts/noto-sans-malayalam.woff2', showcase)).size > 10_000, 'the Malayalam font file is bundled');
assert.match(read('onboarding/fonts/OFL-NotoSansMalayalam.txt'), /SIL OPEN FONT LICENSE/, 'with its licence text');
assert.match(readRepo('THIRD_PARTY_NOTICES.md'), /Noto Sans Malayalam/, 'and its credit');
for (const [file, url] of [['desktop.html', 'onboarding/fonts/noto-sans-malayalam.woff2'], ['onboarding/onboarding.css', 'fonts/noto-sans-malayalam.woff2']]) {
  const css = read(file);
  const face = /@font-face\s*\{[^}]*font-family:\s*"Roamies Malayalam";[^}]*\}/.exec(css)?.[0] ?? '';
  assert.ok(face, `${file} declares the Malayalam face`);
  assert.ok(face.includes(url), `${file}: it loads the bundled file`);
  assert.ok(/U\+0D00-0D7F/.test(face), `${file}: it takes the Malayalam block`);
  assert.ok(!/U\+0020/.test(face), `${file}: and leaves the space to Martian Mono`);
}
assert.match(read('desktop.html'), /document\.fonts\.load\('500 13px "Roamies Malayalam"'/, 'the overlay loads it before its canvas text needs it');
assert.match(read('onboarding/onboarding.css'), /--mono:\s*"Martian Mono",\s*"Roamies Arabic",\s*"Roamies Malayalam"/, 'the panel stack has it after the Arabic letters');
for (const f of ['glass.js', 'ink.js', 'agent.js', 'agent-panel.js', 'agent-home.js', 'ask-bar.js', 'notch.js']) {
  assert.match(read(`roamies/${f}`), /"Martian Mono", "Roamies Arabic", "Roamies Malayalam"/, `${f}: Malayalam letters after the Arabic ones`);
}

// ---- telling Malayalam text ----
assert.ok(hasMalayalam('നമസ്കാരം') && hasMalayalam('open മലയാളം now') && !hasMalayalam('hello') && !hasMalayalam('नमस्ते') && !hasMalayalam(null));
assert.equal(ML, 'ml-IN');
assert.deepEqual(ML_ENGINES, ['local', 'gemini']);

// ---- spoken Malayalam: the sentences split as English ones do, the cue still comes out, and nothing about the language is sent ----
const out = [];
const st = new SpeechText((t) => out.push(t));
st.push('ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്. നാളെ മഴ പെയ്യും. സുഖമാണോ?');
st.flush();
assert.deepEqual(out, ['ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്.', 'നാളെ മഴ പെയ്യും.', 'സുഖമാണോ?'], 'Malayalam is spoken a sentence at a time');
assert.deepEqual(plain('[warm] നമസ്കാരം!'), { text: 'നമസ്കാരം!', style: 'warm' }, 'the English cue becomes the style and the Malayalam stays');
const tts = speechRequest('നമസ്കാരം!', { voice: 'Kore' });
assert.equal(tts.input[0].content[0].text, 'നമസ്കാരം!');
assert.deepEqual(tts.generation_config.speech_config, [{ voice: 'Kore' }], "Gemini's voice detects the language itself: no language field (AI Studio docs, speech generation)");
{
  const calls = [];
  const sse = (b) => `event: step.delta\ndata: ${JSON.stringify({ index: 0, delta: { mime_type: 'audio/l16', data: Buffer.from(b).toString('base64'), channels: 1, sample_rate: 24000, type: 'audio' }, event_type: 'step.delta' })}\n\ndata: [DONE]\n\n`;
  const enc = new TextEncoder();
  const fetchImpl = async (url, o) => { calls.push(JSON.parse(o.body)); return { ok: true, status: 200, body: (async function* () { yield enc.encode(sse([1, 2, 3, 4])); })() }; };
  let ended = false; const audio = [];
  const v = new GeminiVoice({ key: 'k', fetchImpl, onAudio: (a) => audio.push(a), onEnd: () => { ended = true; }, onError: (e) => assert.fail(e.message) });
  v.say('നമസ്കാരം, സുഖമാണോ?'); v.end();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(ended && audio.length === 1, 'a Malayalam sentence is asked for and played (it is not mistaken for "nothing to say")');
  assert.equal(calls[0].input[0].content[0].text, 'നമസ്കാരം, സുഖമാണോ?');
}

// ---- the recording the voice helper leaves ----
const wavOf = (n = 1600) => {
  const pcm = Buffer.alloc(n * 2), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
assert.ok(isWav(wavOf()) && !isWav(Buffer.from('nope')) && !isWav(Buffer.alloc(10)));
const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'roamies-ml-test-'));
{
  const good = path.join(dir, 'roamies-ml-4242-7.wav');
  await fsp.writeFile(good, wavOf());
  const got = await readClip(good);
  assert.ok(got.equals(wavOf()), 'the clip is read');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!fs.existsSync(good), 'and deleted');
  const other = path.join(dir, 'secrets.txt');
  await fsp.writeFile(other, 'x');
  await assert.rejects(readClip(other), { code: 'clip' }, 'a file that is not the helper\'s is never read');
  assert.ok(fs.existsSync(other), 'nor deleted');
  const junk = path.join(dir, 'roamies-ml-1-1.wav');
  await fsp.writeFile(junk, 'not a wav at all, just text that is long enough to look like a file, and more, and more, and more');
  await assert.rejects(readClip(junk), { code: 'clip' }, 'a clip that is not a WAV is refused');
  await assert.rejects(readClip(undefined), { code: 'clip' });
}

// ---- Gemini ----
{
  const wav = wavOf();
  const req = geminiRequest(wav);
  assert.equal(req.model, 'gemini-3.8-flash');
  assert.equal(req.input[1].type, 'audio'); assert.equal(req.input[1].mime_type, 'audio/wav'); assert.equal(req.input[1].data, wav.toString('base64'));
  assert.match(req.input[0].text, /Malayalam script/, 'it asks for Malayalam script, not English letters');
  // The reply comes in whichever shape; thoughts are not words.
  assert.equal(outputText({ output_text: ' ഹലോ ' }), 'ഹലോ');
  assert.equal(outputText({ outputs: [{ type: 'thought', text: 'thinking…' }, { type: 'text', text: 'സുഖമാണോ?' }] }), 'സുഖമാണോ?');
  assert.equal(outputText({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(outputText(null), ''); assert.equal(outputText({}), '');

  let seen;
  const ok = (body) => async (url, o) => { seen = { url, o }; return { ok: true, status: 200, json: async () => body, text: async () => '' }; };
  assert.equal(await transcribeGemini(wav, { key: 'AIza-x', fetchImpl: ok({ outputs: [{ type: 'text', text: ' നമസ്കാരം [BLANK_AUDIO] ' }] }) }), 'നമസ്കാരം', 'noise tags are dropped');
  assert.match(seen.url, /\/v1beta\/interactions$/);
  assert.equal(seen.o.headers['x-goog-api-key'], 'AIza-x');
  assert.equal(JSON.parse(seen.o.body).input[1].data, wav.toString('base64'));
  const bad = (status, text = '') => async () => ({ ok: false, status, text: async () => text, json: async () => null });
  await assert.rejects(transcribeGemini(wav, { key: 'k', fetchImpl: bad(403, '{"error":{"message":"API key not valid"}}') }), { code: 'key' });
  await assert.rejects(transcribeGemini(wav, { key: 'k', fetchImpl: bad(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}') }), { code: 'key' });
  await assert.rejects(transcribeGemini(wav, { key: 'k', fetchImpl: bad(429) }), { code: 'rate' });
  await assert.rejects(transcribeGemini(wav, { key: 'k', fetchImpl: bad(500, '{"error":{"message":"boom"}}') }), { code: 'network', message: /boom/ });
  await assert.rejects(transcribeGemini(wav, { key: 'k', fetchImpl: async () => { throw new Error('offline'); } }), { code: 'network' });
}

// ---- a whisper.cpp server on this computer ----
{
  const wav = wavOf();
  let call;
  const answer = (body, status = 200) => async (url, o) => { call = { url, body: o.body }; return { ok: status < 300, status, json: async () => body }; };
  assert.equal(await transcribeLocal(wav, { url: 'http://127.0.0.1:8178/', fetchImpl: answer({ text: ' ഇന്ന് നല്ല ദിവസം. [BLANK_AUDIO]' }) }), 'ഇന്ന് നല്ല ദിവസം.');
  assert.equal(call.url, 'http://127.0.0.1:8178/inference', "whisper.cpp's own address");
  assert.equal(call.body.get('language'), 'ml', 'the language is fixed to Malayalam');
  assert.equal(call.body.get('response_format'), 'json');
  assert.ok(call.body.get('file') instanceof Blob);
  await transcribeLocal(wav, { url: 'http://localhost:9000/v1', fetchImpl: answer({ text: 'x' }) });
  assert.equal(call.url, 'http://localhost:9000/v1/audio/transcriptions', 'an OpenAI-style server by its /v1 address');
  await assert.rejects(transcribeLocal(wav, { url: 'http://127.0.0.1:8178', fetchImpl: answer({}, 500) }), { code: 'local_down' });
  await assert.rejects(transcribeLocal(wav, { url: 'http://127.0.0.1:8178', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), { code: 'local_down', message: /ECONNREFUSED/ });
}

// ---- checking what they pointed me to ----
const exe = path.join(dir, 'whisper-server.exe'), model = path.join(dir, 'ggml-ml-medium-q5.bin');
await fsp.writeFile(exe, '');
await fsp.writeFile(model, ''); await fsp.truncate(model, 21e6);
assert.deepEqual(await checkSetup({ exe, model }), { ok: true, why: '' });
assert.equal((await checkSetup({})).ok, false);
assert.match((await checkSetup({ exe: path.join(dir, 'notepad.exe'), model })).why, /whisper-server/, 'only whisper-server is ever started');
assert.match((await checkSetup({ exe, model: path.join(dir, 'model.txt') })).why, /\.bin/);
assert.match((await checkSetup({ exe: path.join(dir, 'whisper-server'), model })).why, /can't find whisper-server/);
await fsp.writeFile(path.join(dir, 'tiny.bin'), 'x');
assert.match((await checkSetup({ exe, model: path.join(dir, 'tiny.bin') })).why, /can't find the Malayalam model|whole file/, 'a half-downloaded model is not enough');

// ---- starting whisper-server ----
const fakeChild = () => {
  const c = new EventEmitter();
  c.stderr = new EventEmitter(); c.exitCode = null; c.killed = 0;
  c.kill = () => { c.killed++; c.exitCode = 0; c.emit('exit', 0); };
  return c;
};
{
  let tries = 0, spawned = [];
  const child = fakeChild();
  const s = new LocalServer({
    exe, model, port: 8190, wait: 8000,
    spawnImpl: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return child; },
    fetchImpl: async () => { if (++tries < 3) throw new Error('refused'); return { ok: true }; },
  });
  assert.equal(s.url, 'http://127.0.0.1:8190');
  await Promise.all([s.ensure(), s.ensure()]);
  assert.equal(spawned.length, 1, 'started once, however many takes ask at the same time');
  assert.deepEqual(spawned[0].args, ['-m', model, '--host', '127.0.0.1', '--port', '8190', '-l', 'ml'], 'only on this computer, in Malayalam');
  assert.equal(spawned[0].cmd, exe); assert.equal(spawned[0].opts.windowsHide, true);
  await s.ensure();
  assert.equal(spawned.length, 1, 'and kept for the next take');
  s.stop();
  assert.equal(child.killed, 1, 'stopped on request');
}
{
  const child = fakeChild();
  const s = new LocalServer({ exe, model, wait: 8000, spawnImpl: () => { setImmediate(() => { child.stderr.emit('data', 'failed to load model\n'); child.emit('exit', 1); }); return child; }, fetchImpl: async () => { throw new Error('refused'); } });
  await assert.rejects(s.ensure(), { code: 'local_down', message: /exit 1.*failed to load model/s }, 'a server that dies at start says why');
  await assert.rejects(s.ensure(), { code: 'local_down' }, 'and the next take tries again');
}
{
  const s = new LocalServer({ exe, model, wait: 700, spawnImpl: () => fakeChild(), fetchImpl: async () => { throw new Error('refused'); } });
  await assert.rejects(s.ensure(), { code: 'local_down', message: /too long/ }, 'one that never answers is given up on');
}

// ---- the engine in use ----
{
  const wav = wavOf();
  let cfg = { mlEngine: 'local' }, key = null, calls = [], ensured = 0, stopped = 0, made = 0;
  const fetchImpl = async (url, o) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ text: ' നമസ്കാരം ', outputs: [{ type: 'text', text: 'ഗെമിനി' }] }), text: async () => '' }; };
  const ears = createEars({
    config: () => cfg, geminiKey: async () => key, fetchImpl,
    makeServer: () => { made++; return { url: 'http://127.0.0.1:8178', ensure: async () => { ensured++; }, stop: () => { stopped++; } }; },
  });
  assert.equal(ears.engine(), 'local', 'on this computer unless they pick Gemini');

  await assert.rejects(ears.hear(wav), { code: 'setup' }, 'nothing set up: it says so');
  assert.equal(calls.length, 0, 'and sends the take nowhere');
  assert.deepEqual(await ears.status(), { engine: 'local', ready: false, note: 'Not set up yet.' });

  cfg = { mlEngine: 'local', mlServer: path.join(dir, 'whisper-server'), mlModel: model };
  await assert.rejects(ears.hear(wav), { code: 'setup', message: /can't find whisper-server/ });
  assert.equal(calls.length, 0, 'a broken setup never turns into a cloud request, even with a Gemini key saved');
  key = 'AIza-saved';
  await assert.rejects(ears.hear(wav), { code: 'setup' });
  assert.ok(!calls.some((u) => u.includes('googleapis')), 'not even then');

  cfg = { mlEngine: 'local', mlServer: exe, mlModel: model };
  assert.deepEqual(await ears.status(), { engine: 'local', ready: true, note: '' });
  assert.equal(await ears.hear(wav), 'നമസ്കാരം');
  assert.equal(await ears.hear(wav), 'നമസ്കാരം');
  assert.equal(made, 1, 'one server for the same program and model'); assert.equal(ensured, 2);
  assert.ok(calls.every((u) => u.startsWith('http://127.0.0.1:8178/inference')), calls.join());
  cfg = { mlEngine: 'local', mlServer: exe, mlModel: path.join(dir, 'ggml-ml-medium-q5.bin') };
  await ears.hear(wav);
  cfg = { mlEngine: 'local', mlServer: exe, mlModel: model, mlUrl: '' };
  const second = path.join(dir, 'whisper_server.exe'); await fsp.writeFile(second, '');
  cfg = { mlEngine: 'local', mlServer: second, mlModel: model };
  await ears.hear(wav);
  assert.equal(made, 2, 'a different program starts a new server'); assert.equal(stopped, 1, 'and the old one is stopped');

  cfg = { mlEngine: 'local', mlUrl: 'http://127.0.0.1:9999' };
  calls = [];
  assert.equal(await ears.hear(wav), 'നമസ്കാരം', 'or a server they run themselves');
  assert.ok(calls[0].startsWith('http://127.0.0.1:9999/inference'));

  cfg = { mlEngine: 'gemini' }; key = null;
  await assert.rejects(ears.hear(wav), { code: 'key' }, 'Gemini without a key says so');
  assert.deepEqual(await ears.status(), { engine: 'gemini', ready: false, note: '' });
  key = 'AIza-saved'; calls = [];
  assert.equal(await ears.hear(wav), 'ഗെമിനി');
  assert.ok(calls[0].includes('googleapis.com') && calls[0].endsWith('/interactions'));
  assert.deepEqual(await ears.status(), { engine: 'gemini', ready: true, note: '' });
  cfg = { mlEngine: 'nonsense' };
  assert.equal(ears.engine(), 'local', 'an unknown engine falls back to the private one');
  ears.stop(); assert.equal(stopped, 2);
}

// ---- the wiring between the layers ----
{
  const sk = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  assert.match(sk, /const SPEECH_LANGS = MAC \? \[[^\]]*\] : \['auto', ML\]/, 'Windows and Linux offer Malayalam, the Mac list is unchanged');
  assert.match(sk, /lang: speechLangId\(\)/, 'the language reaches the voice helper on every platform');
  assert.match(sk, /id\.startsWith\('speechlang:'\)\) \{/, 'and can be picked on every platform');
  assert.match(sk, /id\.startsWith\('mlengine:'\)/, 'the engine can be picked');
  assert.match(sk, /m\.type === 'panel_ml_paths'/, 'and the program and model saved');
  assert.match(sk, /m\.type === 'voice' && m\.audio\?\.file\) onClip/, 'a recorded take goes to the engine');
  assert.match(sk, /malayalamOn\(\) \? `- Language: \$\{userName\} talks to you in Malayalam/, 'the agent is told to answer in Malayalam only while it is on');
  assert.match(sk, /overlay\(\{ type: 'final', text \}\);\s*overlay\(\{ type: 'state', state: 'idle' \}\);\s*onSpoken/, 'the overlay gets the words, then the end of the talk, as from the helper');
  assert.match(sk, /ml: MAC \? null : \{/, 'the panel is told how Malayalam stands');
  const panel = read('panel/panel.js');
  assert.match(panel, /\['ml-IN', 'മലയാളം · Malayalam'\]/, 'the panel offers it, named in its own script');
  assert.match(panel, /type: 'panel_ml_paths'/);
  assert.match(panel, /v\.on \? speakPicker\(v\) : null/, 'for every platform');
  const rs = readRepo('showcase/tauri/src-tauri/voice-win/src/main.rs');
  assert.match(rs, /roamies-ml-\{\}-\{\}\.wav/, 'the helper names the clip as readClip expects');
  assert.match(rs, /id == "ml-IN"/, 'and records, rather than reads, takes in Malayalam');
  const vrs = readRepo('showcase/tauri/src-tauri/src/voice.rs');
  assert.match(vrs, /"audio": clip/, 'the app passes the clip on');
}

await fsp.rm(dir, { recursive: true, force: true });
console.log('malayalam tests: passed');
