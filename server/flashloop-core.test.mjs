/* Unit tests for the DOM-free core inside dist/flashloop.js (between the CORE START / CORE END markers).
   Run:  node --test server/flashloop-core.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const candidates = [new URL('../dist/flashloop.js', import.meta.url), new URL('../flashloop.js', import.meta.url)];
const file = candidates.find(u => fs.existsSync(u));
assert.ok(file, 'could not find dist/flashloop.js');
const source = fs.readFileSync(file, 'utf8');
const coreSource = source.slice(source.indexOf('/* ==== CORE START ==== */'), source.indexOf('/* ==== CORE END ==== */'));
assert.ok(coreSource.length > 1000, 'CORE markers not found');

function loadCore({ withCrypto = true } = {}) {
  const ctx = vm.createContext({ window: {}, ...(withCrypto ? { crypto: webcrypto } : {}) });
  vm.runInContext(coreSource, ctx);
  return ctx.window.NexoraFlashLoopCore;
}
const Core = loadCore();
const plain = x => JSON.parse(JSON.stringify(x));
const words = s => s.split(/\s+/).filter(Boolean);
const para = (n, label = 'Sentence') => Array.from({ length: n }, (_, i) => `${label} number ${i} explains one idea clearly.`).join(' ');
const bigText = (chars) => { const out = []; let len = 0, i = 0; while (len < chars) { const p = `Paragraph ${i++}. ${para(6)}`; out.push(p); len += p.length + 2; } return out.join('\n\n'); };

/* ---------------- chunking ---------------- */
test('chunkText: every chunk fits the limit and no words are lost (paragraph text)', () => {
  const text = bigText(40000), chunks = Core.chunkText(text, 7000);
  assert.ok(chunks.length >= 5);
  chunks.forEach(c => assert.ok(c.length <= 7000 + Core.LIMITS.minChunkChars + 2, `chunk too long: ${c.length}`));
  assert.deepEqual(plain(words(chunks.join(' '))), words(Core.cleanText(text)));
});
test('chunkText: one giant paragraph with no blank lines is split on sentences', () => {
  const text = para(900), chunks = Core.chunkText(text, 3000);
  assert.ok(chunks.length > 5); chunks.forEach(c => assert.ok(c.length <= 3000 + 122));
  assert.deepEqual(words(chunks.join(' ')), words(text));
});
test('chunkText: a single 20,000-character word cannot crash it or exceed the limit', () => {
  const chunks = Core.chunkText('x'.repeat(20000), 5000);
  assert.ok(chunks.length >= 4); chunks.forEach(c => assert.ok(c.length <= 5000 + 122));
  assert.equal(chunks.join('').length, 20000);
});
test('chunkText: tiny tail is folded into the previous chunk; empty input gives no chunks', () => {
  const chunks = Core.chunkText(`${'a'.repeat(1990)}\n\nend.`, 2000);
  assert.equal(chunks.length, 1);
  assert.deepEqual(plain(Core.chunkText('   \n\n  ')), []);
});
test('cleanText: normalises line endings, control characters and blank lines', () => {
  assert.equal(Core.cleanText('a\r\nb\u0000\n\n\n\nc\t\td'), 'a\nb\n\nc d');
  assert.equal(Core.cleanText(null), '');
});

/* ---------------- planning (the "intelligent chunking") ---------------- */
test('planChunks: 60k characters / 25 cards -> at most 8 requests, shares add up to 25, each chunk gets a share', () => {
  const plan = Core.planChunks(bigText(60000), 25);
  assert.ok(plan.chunks.length >= 6 && plan.chunks.length <= 8, `chunks: ${plan.chunks.length}`);
  assert.equal(plan.chunks.reduce((a, c) => a + c.share, 0), 25);
  plan.chunks.forEach(c => { assert.ok(c.share >= 1); assert.ok(c.text.length <= Core.LIMITS.maxChunkChars + 130); assert.ok(c.ask >= Core.LIMITS.minRequestCards && c.ask <= 30); });
});
test('planChunks: a 3 MB paste is cut to the limit with a truncation notice and still plans cleanly', () => {
  const plan = Core.planChunks(bigText(3_000_000), 25);
  assert.equal(plan.truncated, true); assert.ok(plan.usedChars <= Core.LIMITS.maxSourceChars); assert.ok(plan.totalChars > 2_900_000);
  assert.ok(plan.chunks.length <= Core.LIMITS.maxChunks);
});
test('planChunks: short text is one request; asking for few cards limits the number of requests', () => {
  assert.equal(Core.planChunks(para(20), 12).chunks.length, 1);
  const few = Core.planChunks(bigText(50000), 5);
  assert.equal(few.chunks.length, 1); assert.equal(few.truncated, true);
});
test('planChunks: empty text, and nonsense card counts, are handled', () => {
  assert.equal(Core.planChunks('', 10).chunks.length, 0);
  assert.equal(Core.planChunks(para(10), 'abc').wanted, 12);
  assert.equal(Core.planChunks(para(10), 999).wanted, 25);
  assert.equal(Core.planChunks(para(10), 1).wanted, 4);
});
test('allocate: sums to the total, never gives a chunk zero, favours longer chunks', () => {
  const a = Core.allocate([100, 100, 800], 10);
  assert.equal(a.reduce((x, y) => x + y, 0), 10); assert.ok(a.every(n => n >= 1)); assert.ok(a[2] > a[0]);
  assert.deepEqual(plain(Core.allocate([], 5)), []);
});
test('autoCardCount: scales with selection size, 3 to 25, zero if too short', () => {
  assert.equal(Core.autoCardCount(10), 0); assert.equal(Core.autoCardCount(100), 3);
  assert.equal(Core.autoCardCount(3500), 10); assert.equal(Core.autoCardCount(50000), 25);
});

/* ---------------- merging ---------------- */
const mk = (p, n) => Array.from({ length: n }, (_, i) => ({ front: `${p} question ${i}?`, back: `${p} answer ${i}` }));
test('mergeCards: de-duplicates, keeps document order, respects shares then fills up to `wanted`', () => {
  const dupe = { front: 'A question 0?', back: 'dup' };
  const merged = Core.mergeCards([[...mk('A', 6)], [dupe, ...mk('B', 6)]], [2, 2], 6);
  assert.equal(merged.length, 6);
  assert.deepEqual(plain(merged.slice(0, 2)).map(c => c.front), ['A question 0?', 'A question 1?']);   // chunk A's share first
  assert.equal(new Set(merged.map(c => c.front.toLowerCase())).size, 6);
});
test('mergeCards: a failed chunk (null) is covered by the others and the cap is honoured', () => {
  const merged = Core.mergeCards([null, mk('B', 10), mk('C', 10)], [3, 3, 3], 9);
  assert.equal(merged.length, 9); assert.ok(merged.every(c => !c.front.startsWith('A')));
  assert.equal(Core.mergeCards([mk('A', 3)], [3], 2).length, 2);
});
test('mergeCards: ignores malformed items without throwing', () => {
  assert.equal(Core.mergeCards([[null, {}, { front: 'ok question?', back: '' }, { front: 'good?', back: 'yes' }]], [4], 4).length, 1);
});

/* ---------------- notes -> text / blocks / local cards ---------------- */
const note = { title: 'Design Patterns', overview: 'Reusable solutions.', sections: [{ heading: 'Observer', points: ['Subject notifies observers.', 'Decouples publishers.'] }, { heading: '', points: [] }, { heading: 'Singleton', points: ['One instance only.'] }], takeaways: ['Prefer composition.'] };
test('noteToText / noteToBlocks / localCardsFromNote handle a normal note', () => {
  const text = Core.noteToText(note);
  assert.match(text, /# Design Patterns/); assert.match(text, /## Observer\n- Subject notifies observers\./); assert.match(text, /Key takeaways:/);
  assert.equal(plain(Core.noteToBlocks(note)).filter(b => b.type === 'heading').length, 3);   // 2 sections + takeaways
  assert.deepEqual(plain(Core.localCardsFromNote(note)), [{ front: 'Observer', back: 'Subject notifies observers.\nDecouples publishers.' }, { front: 'Singleton', back: 'One instance only.' }]);
});
test('note helpers survive junk input', () => {
  for (const bad of [null, undefined, {}, { sections: 'nope' }, { sections: [null, 5, { points: 'x' }] }, { takeaways: 9 }]) {
    assert.doesNotThrow(() => { Core.noteToText(bad); Core.noteToBlocks(bad); Core.localCardsFromNote(bad); });
  }
});
test('localCardsFromText: finds "Term: definition" lines and "X is a Y" sentences, and respects the cap', () => {
  const t = 'Latency: the delay before a transfer of data begins.\nA compiler is a program that translates source code into machine code. Bandwidth refers to the maximum rate of data transfer.';
  const cards = plain(Core.localCardsFromText(t, 25));
  assert.ok(cards.length >= 3); assert.ok(cards.some(c => /Latency/.test(c.front)));
  assert.ok(plain(Core.localCardsFromText('Cells are the basic units of every living organism on earth.')).some(c => c.front === 'What are Cells?'));
  assert.equal(Core.localCardsFromText(t, 1).length, 1); assert.deepEqual(plain(Core.localCardsFromText('', 5)), []);
});

/* ---------------- SM-2 ---------------- */
test('schedule: standard SM-2 progression 1 -> 6 -> interval x easiness', () => {
  let c = { repetitions: 0, intervalDays: 0, easiness: 2.5 };
  c = { ...c, ...Core.schedule(c, 4) }; assert.deepEqual([c.repetitions, c.intervalDays], [1, 1]);
  c = { ...c, ...Core.schedule(c, 4) }; assert.deepEqual([c.repetitions, c.intervalDays], [2, 6]);
  c = { ...c, ...Core.schedule(c, 4) }; assert.deepEqual([c.repetitions, c.intervalDays], [3, 15]);   // round(6 x 2.5)
  assert.equal(c.easiness, 2.5);                                                                          // "Good" leaves easiness unchanged
});
test('schedule: easiness moves with quality (Hard lowers it, Easy raises it) and never drops below 1.3', () => {
  assert.ok(Math.abs(Core.schedule({ repetitions: 1, intervalDays: 1, easiness: 2.5 }, 3).easiness - 2.36) < 1e-9);
  assert.ok(Math.abs(Core.schedule({ repetitions: 1, intervalDays: 1, easiness: 2.5 }, 5).easiness - 2.6) < 1e-9);
  let c = { repetitions: 0, intervalDays: 0, easiness: 2.5 };
  for (let i = 0; i < 60; i++) c = { ...c, ...Core.schedule(c, 3) };
  assert.equal(c.easiness, 1.3);
});
test('schedule: "Again" (q < 3) resets the card for an early retry', () => {
  assert.deepEqual(plain(Core.schedule({ repetitions: 7, intervalDays: 90, easiness: 2.2 }, 1)), { easiness: 2.2, intervalDays: 0, repetitions: 0 });
});
test('schedule: corrupt or extreme input always yields valid numbers', () => {
  for (const card of [null, {}, { easiness: NaN, intervalDays: 'x', repetitions: -5 }, { easiness: -3, intervalDays: 1e12, repetitions: 1e9 }, { easiness: 99, intervalDays: 0.4, repetitions: 2.7 }]) {
    for (const q of [0, 3, 4, 5, 7, -1, NaN, undefined]) {
      const r = Core.schedule(card, q);
      assert.ok(Number.isFinite(r.easiness) && r.easiness >= 1.3 && r.easiness <= 4);
      assert.ok(Number.isInteger(r.intervalDays) && r.intervalDays >= 0 && r.intervalDays <= 3650);
      assert.ok(Number.isInteger(r.repetitions) && r.repetitions >= 0);
    }
  }
});
test('schedule: intervals are capped at the maximum', () => {
  assert.equal(Core.schedule({ repetitions: 10, intervalDays: 3000, easiness: 3.5 }, 5).intervalDays, 3650);
});
test('nextDueAt: now for 0, in the future for N days, safe for junk', () => {
  const now = 1_700_000_000_000;
  assert.equal(Core.nextDueAt(0, now), new Date(now).toISOString());
  assert.equal(Core.nextDueAt(3, now), new Date(now + 3 * 86400000).toISOString());
  assert.equal(Core.nextDueAt(-5, now), new Date(now).toISOString());
  assert.equal(Core.nextDueAt('abc', now), new Date(now).toISOString());
  assert.equal(Core.nextDueAt(1e12, now), new Date(now + 3650 * 86400000).toISOString());
});

/* ---------------- data repair ---------------- */
test('normalizeDecks: non-arrays give an empty list; junk decks and cards are repaired or dropped', () => {
  assert.deepEqual(plain(Core.normalizeDecks(null)), { decks: [], repaired: false });
  assert.equal(Core.normalizeDecks('garbage').decks.length, 0);
  const { decks, repaired } = Core.normalizeDecks([
    null, 5,
    { title: '  ', cards: 'nope' },
    { id: 'd1', title: 'Good', cards: [
      { id: 'c1', front: 'Q?', back: 'A', easiness: 'abc', dueAt: 'not a date', repetitions: -3, intervalDays: 99999 },
      { id: 'c1', front: 'Dup id?', back: 'A' }, { front: '', back: 'x' }, null, { front: 'No id?', back: 'fine' },
    ] },
    { id: 'd1', title: 'Duplicate deck id', cards: [] },
  ]);
  assert.equal(repaired, true); assert.equal(decks.length, 3);
  const good = decks.find(d => d.title === 'Good');
  assert.equal(good.cards.length, 3);
  assert.equal(new Set(good.cards.map(c => c.id)).size, 3);
  good.cards.forEach(c => { assert.equal(c.deckId, good.id); assert.ok(!Number.isNaN(new Date(c.dueAt).getTime())); assert.ok(c.easiness >= 1.3 && c.repetitions >= 0 && c.intervalDays <= 3650); });
  assert.equal(new Set(decks.map(d => d.id)).size, 3);
});
test('normalizeDecks is idempotent (a clean deck comes back unchanged)', () => {
  const clean = Core.normalizeDecks([{ id: 'd', title: 'T', cards: [Core.makeCard({ front: 'Q?', back: 'A', deckId: 'd' })] }]).decks;
  const again = Core.normalizeDecks(plain(clean));
  assert.equal(again.repaired, false); assert.deepEqual(plain(again.decks), plain(clean));
});
test('makeCard creates a fresh, valid SM-2 card', () => {
  const c = Core.makeCard({ front: 'Q?', back: 'A', deckId: 'd1', sourceId: 'n1' });
  assert.deepEqual([c.repetitions, c.intervalDays, c.easiness, c.sourceId], [0, 0, 2.5, 'n1']); assert.ok(c.id && c.dueAt);
});

/* ---------------- misc ---------------- */
test('newId works with and without crypto.randomUUID (e.g. over a plain-HTTP LAN address)', () => {
  const noCrypto = loadCore({ withCrypto: false });
  const ids = new Set(Array.from({ length: 200 }, () => noCrypto.newId()));
  assert.equal(ids.size, 200); [...ids].forEach(id => assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/));
  assert.match(Core.newId(), /^[0-9a-f-]{36}$/);
});
test('toCsv quotes and escapes; stripExt and frontKey behave', () => {
  assert.equal(Core.toCsv([{ front: 'Say "hi", ok?', back: 'line1\nline2' }]), '"Say ""hi"", ok?","line1\nline2"');
  assert.equal(Core.stripExt('NEXORA-1.pptx.pdf'), 'NEXORA-1'); assert.equal(Core.stripExt('notes.TXT'), 'notes');
  assert.equal(Core.frontKey('  What   IS  X? '), 'what is x?');
});
