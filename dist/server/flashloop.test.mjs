import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { normalizeNote, normalizeCount, normalizeFile, parseCards, generateCards, handleGenerate } from './flashloop.mjs';

const note = {
  title: 'Design Patterns', overview: 'Reusable solutions to common software design problems in object oriented code.',
  sections: [{ heading: 'Observer', points: ['A subject notifies subscribed observers when its state changes.', 'Decouples publishers from subscribers.'] }],
  takeaways: ['Prefer composition over inheritance when behaviour varies.'],
};
const goodReply = JSON.stringify({ cards: [{ front: 'What does the Observer pattern do?', back: 'A subject notifies its subscribers when state changes.' }] });
const silence = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };
const fakeRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b ? JSON.parse(b) : null; } }; return r; };
const fakeReq = (method, body) => Object.assign(Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}))]), { method });

test('normalizeNote flattens sections and takeaways', () => {
  const s = normalizeNote(note);
  assert.match(s.text, /## Observer/); assert.match(s.text, /Key takeaways/); assert.equal(s.title, 'Design Patterns');
});
test('normalizeNote rejects empty or non-object input', () => {
  assert.throws(() => normalizeNote(null), { status: 400 });
  assert.throws(() => normalizeNote({ title: 'x', sections: [] }), { status: 400 });
});
test('normalizeNote caps source length', () => {
  assert.ok(normalizeNote({ title: 'Big', text: 'word '.repeat(20000) }).text.length <= 14000);
});
test('normalizeCount clamps to 4..30 and defaults', () => {
  assert.equal(normalizeCount(1), 4); assert.equal(normalizeCount(999), 30); assert.equal(normalizeCount('abc'), 12); assert.equal(normalizeCount(12), 12);
});
test('parseCards handles code fences, dedupes, drops LaTeX and respects count', () => {
  const raw = '```json\n' + JSON.stringify({ cards: [
    { front: 'What is a race condition?', back: 'Outcome depends on thread timing.' },
    { front: 'what is a race condition?', back: 'Duplicate front.' },
    { front: 'Solve the integral', back: 'Use $$\\frac{1}{2}$$' },
    { front: 'Define deadlock.', back: 'Processes wait on each other forever.' },
    { front: 'Define starvation.', back: 'A process is never scheduled.' },
  ] }) + '\n```';
  const cards = parseCards(raw, 2);
  assert.deepEqual(cards.map(c => c.front), ['What is a race condition?', 'Define deadlock.']);
});
test('parseCards accepts a bare array and prose around JSON', () => {
  assert.equal(parseCards('Here you go: ' + JSON.stringify([{ front: 'What is X exactly?', back: 'Y.' }])).length, 1);
});
test('parseCards throws on garbage', () => {
  assert.throws(() => parseCards('nope'));
  assert.throws(() => parseCards('{"cards":[{"front":"a","back":""}]}'));
});

test('generateCards: 503 when no provider keys are configured', async () => {
  await assert.rejects(generateCards(note, { env: {}, fetchImpl: async () => { throw new Error('should not be called'); } }), { status: 503 });
});
test('generateCards: falls through Gemini failures to Groq and never sends keys in the URL', async () => {
  const restore = silence(); const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('generativelanguage')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: goodReply } }] }) };
  };
  const out = await generateCards(note, { count: 6, env: { GEMINI_API_KEY: 'g-secret', GROQ_API_KEY: 'q-secret' }, fetchImpl, sleep: async () => {} });
  restore();
  assert.equal(out.provider, 'Groq'); assert.equal(out.cards.length, 1);
  assert.ok(calls.every(c => !c.url.includes('secret')), 'keys must not appear in URLs');
  assert.equal(calls.find(c => c.url.includes('generativelanguage')).init.headers['x-goog-api-key'], 'g-secret');
  assert.equal(calls.find(c => c.url.includes('groq')).init.headers.Authorization, 'Bearer q-secret');
});
test('generateCards: 502 when every provider fails', async () => {
  const restore = silence();
  await assert.rejects(generateCards(note, { env: { GROQ_API_KEY: 'k' }, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), { status: 502 });
  restore();
});
test('generateCards: honours FLASHLOOP_GEMINI_MODELS', async () => {
  const urls = [];
  await generateCards(note, { env: { GEMINI_API_KEY: 'k', FLASHLOOP_GEMINI_MODELS: 'my-model' },
    fetchImpl: async url => { urls.push(url); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: goodReply }] } }] }) }; } });
  assert.match(urls[0], /models\/my-model:generateContent/);
});

test('handler: 405 for GET', async () => {
  const res = fakeRes(); await handleGenerate(fakeReq('GET'), res);
  assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, 'POST');
});
test('handler: 400 for bad JSON and for a missing note', async () => {
  let res = fakeRes(); await handleGenerate(fakeReq('POST', '{not json'), res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await handleGenerate(fakeReq('POST', {}), res); assert.equal(res.statusCode, 400);
});
test('handler: 413 for oversized bodies', async () => {
  const res = fakeRes(); await handleGenerate(fakeReq('POST', 'x'.repeat(15 * 1024 * 1024)), res); assert.equal(res.statusCode, 413);
});
test('handler: 200 with cards on success', async () => {
  const res = fakeRes();
  await handleGenerate(fakeReq('POST', { note, count: 8 }), res, { env: { GROQ_API_KEY: 'k' }, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: goodReply } }] }) }) });
  assert.equal(res.statusCode, 200); assert.equal(res.body.cards[0].front, 'What does the Observer pattern do?');
});
test('handler: provider details never leak into the error body', async () => {
  const restore = silence(); const res = fakeRes();
  await handleGenerate(fakeReq('POST', { note }), res, { env: { GROQ_API_KEY: 'super-secret' }, fetchImpl: async () => { throw new Error('boom super-secret'); } });
  restore();
  assert.equal(res.statusCode, 502); assert.ok(!JSON.stringify(res.body).includes('super-secret'));
});

// ---------- PDF input ----------
const pdf = { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 fake').toString('base64') };
test('normalizeFile accepts a base64 PDF and rejects other types / junk / oversize', () => {
  assert.equal(normalizeFile(pdf).mimeType, 'application/pdf');
  assert.throws(() => normalizeFile({ mimeType: 'text/html', data: pdf.data }), { status: 400 });
  assert.throws(() => normalizeFile({ mimeType: 'application/pdf', data: 'not base64!!' }), { status: 400 });
  assert.throws(() => normalizeFile({ mimeType: 'application/pdf', data: 'A'.repeat(14 * 1024 * 1024) }), { status: 413 });
  assert.throws(() => normalizeFile(null), { status: 400 });
});
test('generateCards with a PDF sends it to Gemini as inlineData and never to Groq', async () => {
  const calls = [];
  const out = await generateCards({ title: 'DS Unit 3' }, { file: pdf, env: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: goodReply }] } }] }) }; } });
  assert.equal(out.provider, 'Gemini'); assert.equal(calls.length, 1); assert.ok(calls[0].url.includes('generativelanguage'));
  assert.equal(calls[0].body.contents[0].parts[0].inlineData.mimeType, 'application/pdf');
  assert.equal(calls[0].body.contents[0].parts[0].inlineData.data, pdf.data);
});
test('generateCards with a PDF but only a Groq key gives a clear 503', async () => {
  await assert.rejects(generateCards({ title: 'x' }, { file: pdf, env: { GROQ_API_KEY: 'q' }, fetchImpl: async () => { throw new Error('no'); } }), { status: 503, message: /GEMINI_API_KEY/ });
});
test('handler: PDF request works end to end without a note body', async () => {
  const res = fakeRes();
  await handleGenerate(fakeReq('POST', { note: { title: 'Unit 3' }, file: pdf, count: 8 }), res,
    { env: { GEMINI_API_KEY: 'g' }, fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: goodReply }] } }] }) }) });
  assert.equal(res.statusCode, 200); assert.equal(res.body.provider, 'Gemini');
});

test('provider error explanations are logged, with the API key redacted', async () => {
  const logs = []; const original = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    await assert.rejects(generateCards(note, { env: { GEMINI_API_KEY: 'AQ.secret-key-123' }, fetchImpl: async () => ({
      ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key: AQ.secret-key-123' } }) }) }), { status: 502 });
  } finally { console.error = original; }
  const all = logs.join('\n');
  assert.match(all, /status 400: API key not valid/);
  assert.ok(!all.includes('AQ.secret-key-123'), 'key must be redacted in logs');
});

test('a transient 503 is retried once on the same model and then succeeds', async () => {
  const restore = silence(); let n = 0; const urls = [];
  const out = await generateCards(note, { env: { GEMINI_API_KEY: 'k', FLASHLOOP_GEMINI_MODELS: 'm1,m2' }, sleep: async () => {},
    fetchImpl: async url => { urls.push(url); n++; return n === 1 ? { ok: false, status: 503, text: async () => '{"error":{"message":"high demand"}}' }
      : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: goodReply }] } }] }) }; } });
  restore();
  assert.equal(out.model, 'm1'); assert.equal(urls.length, 2); assert.ok(urls.every(u => u.includes('models/m1:')));
});
test('when every model is overloaded the user gets a clear 503 "busy" message', async () => {
  const restore = silence();
  await assert.rejects(generateCards(note, { env: { GEMINI_API_KEY: 'k', FLASHLOOP_GEMINI_MODELS: 'm1' }, sleep: async () => {},
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'busy' }) }), { status: 503, message: /very busy/ });
  restore();
});
test('non-transient errors (400) are not retried', async () => {
  const restore = silence(); let calls = 0;
  await assert.rejects(generateCards(note, { env: { GEMINI_API_KEY: 'k', FLASHLOOP_GEMINI_MODELS: 'm1' }, sleep: async () => {},
    fetchImpl: async () => { calls++; return { ok: false, status: 400, text: async () => 'bad' }; } }), { status: 502 });
  restore(); assert.equal(calls, 1);
});
test('default model chain includes the lighter fallbacks', async () => {
  const urls = []; const restore = silence();
  await assert.rejects(generateCards(note, { env: { GEMINI_API_KEY: 'k' }, sleep: async () => {}, fetchImpl: async url => { urls.push(url); return { ok: false, status: 404, text: async () => 'nf' }; } }));
  restore();
  assert.ok(urls.some(u => u.includes('gemini-3.1-flash-lite')) && urls.some(u => u.includes('gemini-flash-latest')));
});
