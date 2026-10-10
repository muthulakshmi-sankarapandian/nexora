import test from 'node:test';
import assert from 'node:assert/strict';
import { generateStudyNotes } from './ai.js';

const note = {title:'Factory pattern',overview:'A creation pattern.',sections:[{timestamp:'00:20',heading:'How it works',points:['A factory creates an object.']}],takeaways:['Use it when creation varies.']};
const reply = (status, body) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});

test('falls back to Groq after all Gemini models are unavailable', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('generativelanguage')) return reply(503, {error:{message:'busy'}});
    return reply(200, {choices:[{message:{content:JSON.stringify(note)}}]});
  };
  const result = await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal(result.provider, 'Groq');
  assert.equal(result.notes.title, note.title);
  assert.equal(calls.length, 4);
  assert.match(calls[3], /api\.groq\.com/);
});

test('does not send captions to Groq when Gemini succeeds', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return reply(200, {candidates:[{content:{parts:[{text:JSON.stringify(note)}]}}]});
  };
  const result = await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal(result.provider, 'Gemini');
  assert.equal(calls.length, 1);
});

test('does not bypass a Gemini request rejection', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return reply(400, {error:{message:'invalid'}}); };
  await assert.rejects(generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl}), /Gemini rejected/);
  assert.equal(calls.length, 1);
});

test('does not send captions to Groq without a configured Gemini primary', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return reply(200, {choices:[{message:{content:JSON.stringify(note)}}]}); };
  await assert.rejects(generateStudyNotes('Synthetic captions', {groqKey:'test-groq',fetchImpl}), /Gemini API key/);
  assert.equal(calls, 0);
});

test('sends provider-compatible schema formats', async () => {
  const bodies = [];
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return url.includes('generativelanguage') ? reply(503, {error:{message:'busy'}}) : reply(200, {choices:[{message:{content:JSON.stringify(note)}}]});
  };
  await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal('additionalProperties' in bodies[0].generationConfig.responseSchema, false);
  assert.equal('additionalProperties' in bodies[0].generationConfig.responseSchema.properties.sections.items, false);
  assert.equal(bodies[3].response_format.json_schema.schema.additionalProperties, false);
  assert.equal(bodies[3].max_completion_tokens, 8192);
});

test('uses another Gemini model when the first is busy', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return calls.length === 1 ? reply(503, {}) : reply(200, {candidates:[{content:{parts:[{text:JSON.stringify(note)}]}}]});
  };
  const result = await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal(result.model, 'gemini-3.7-flash');
  assert.equal(calls.length, 2);
});

test('uses another Groq model when the first is busy', async () => {
  const models = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('generativelanguage')) return reply(503, {});
    models.push(JSON.parse(options.body).model);
    return models.length === 1 ? reply(503, {}) : reply(200, {choices:[{message:{content:JSON.stringify(note)}}]});
  };
  const result = await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal(result.model, 'openai/gpt-oss-20b');
  assert.deepEqual(models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
});

test('uses another Groq model when strict JSON generation fails', async () => {
  const models = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('generativelanguage')) return reply(503, {});
    models.push(JSON.parse(options.body).model);
    return models.length === 1
      ? reply(400, {error:{message:'max completion tokens reached before generating a valid document'}})
      : reply(200, {choices:[{message:{content:JSON.stringify(note)}}]});
  };
  const result = await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal(result.model, 'openai/gpt-oss-20b');
  assert.deepEqual(models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
});

test('tries the next model after a rate limit', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return calls.length === 1 ? reply(429, {}) : reply(200, {candidates:[{content:{parts:[{text:JSON.stringify(note)}]}}]});
  };
  const result = await generateStudyNotes('Synthetic captions', {geminiKey:'test-gemini',groqKey:'test-groq',fetchImpl});
  assert.equal(result.model, 'gemini-3.7-flash');
  assert.equal(calls.length, 2);
});
