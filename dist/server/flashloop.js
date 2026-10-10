/* FlashLoop — spaced repetition, on the shared Nexora data contract.
   Storage: nexora-flashloop-decks (decks + nested cards), nexora-flashloop-reviews (review history).
   Event out: nexora:flashcard-reviewed { cardId, deckId, rating, reviewedAt, nextDueAt } */
(() => {
  const h = NexoraH, D = NexoraDate, S = NexoraStore, say = NexoraSay;
  const DECKS_KEY = 'nexora-flashloop-decks';
  const REVIEWS_KEY = 'nexora-flashloop-reviews';
  const OLD_KEY = 'nexora-flashloop-cards'; // earlier local-only format, migrated once

  function migrateLegacyCards() {
    if (S.get(DECKS_KEY, null)) return; // already on the new format
    const legacy = S.get(OLD_KEY, []);
    if (!legacy.length) return;
    const byDeck = {};
    legacy.forEach(c => {
      const deckId = byDeck[c.deck]?.id || crypto.randomUUID();
      byDeck[c.deck] = byDeck[c.deck] || { id: deckId, title: c.deck, sourceId: null, createdAt: D.isoNow(), cards: [] };
      byDeck[c.deck].cards.push({
        id: c.id || crypto.randomUUID(), deckId: byDeck[c.deck].id, front: c.front, back: c.back, sourceId: null,
        repetitions: c.reps || 0, intervalDays: c.interval || 0, easiness: c.ef || 2.5,
        dueAt: c.due ? `${c.due}T00:00:00.000Z` : D.isoNow(), lastReviewedAt: null, createdAt: D.isoNow(),
      });
    });
    S.set(DECKS_KEY, Object.values(byDeck));
  }

  const loadDecks = () => S.get(DECKS_KEY, []);
  const saveDecks = decks => { if (!S.set(DECKS_KEY, decks)) say('Browser storage is full or unavailable.'); };
  const allCards = () => loadDecks().flatMap(d => d.cards.map(c => ({ ...c, deckTitle: d.title })));
  const dueCards = () => { const now = Date.now(); return allCards().filter(c => new Date(c.dueAt).getTime() <= now); };

  const RATINGS = [['Again', 'again', 1], ['Hard', 'hard', 3], ['Good', 'good', 4], ['Easy', 'easy', 5]];
  const schedule = (card, q) => {
    let { easiness, intervalDays, repetitions } = card;
    if (q < 3) { repetitions = 0; intervalDays = 0; } // early retry, same session
    else {
      repetitions += 1;
      intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(intervalDays * easiness);
      easiness = Math.max(1.3, easiness + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    }
    return { easiness, intervalDays, repetitions };
  };
  const nextDueAt = interval => interval === 0 ? new Date().toISOString() : new Date(Date.now() + interval * 86400000).toISOString();
  const daysLabel = d => (d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);

  let queue = [], revealed = false, sessionTotal = 0;
  let immersive = false, usedFullscreenApi = false, ui = null; // ui = handles to the current card's DOM
  const gen = { busy: false, source: '', count: 12, error: '', info: '' };
  let vaultFiles = [];
  const startQueue = () => { queue = dueCards().map(c => c.id); sessionTotal = queue.length; revealed = false; };

  const root = h('section', 'nx-module-view nx-m3');
  root.id = 'nx-flashloop';
  root.setAttribute('aria-labelledby', 'nx-flashloop-title');

  function findCard(id) { for (const d of loadDecks()) { const c = d.cards.find(x => x.id === id); if (c) return { card: c, deck: d }; } return null; }

  const stat = (label, value, hint) => {
    const d = h('div', 'nx-m3-stat');
    d.append(h('span', 'nx-m3-stat-label', label), h('strong', 'nx-m3-stat-value nx-m3-gradient', String(value)), h('span', 'nx-m3-stat-hint', hint));
    return d;
  };
  const panelHead = (title, sub) => {
    const head = h('div', 'nx-m3-panel-head'); const box = h('div');
    box.append(h('h2', 'nx-m3-title', title)); if (sub) box.append(h('p', 'nx-m3-sub', sub));
    head.append(box); return head;
  };

  // ---- Full-screen / immersive review ---------------------------------------
  // `root` is never removed from the page (render() only replaces its children), so it is the
  // element we put into fullscreen. If the Fullscreen API is refused (e.g. iOS Safari) the same
  // CSS class still expands it into a fixed full-viewport overlay.
  async function enterImmersive() {
    if (immersive) return;
    immersive = true; usedFullscreenApi = false;
    root.classList.add('nx-m3-immersive'); document.documentElement.classList.add('nx-m3-lock');
    render();
    if (root.requestFullscreen) { try { await root.requestFullscreen(); usedFullscreenApi = true; } catch (_) { /* overlay fallback */ } }
  }
  function exitImmersive() {
    if (!immersive) return;
    immersive = false; usedFullscreenApi = false;
    root.classList.remove('nx-m3-immersive'); document.documentElement.classList.remove('nx-m3-lock');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    render();
  }
  document.addEventListener('fullscreenchange', () => { if (immersive && usedFullscreenApi && !document.fullscreenElement) exitImmersive(); });
  window.addEventListener('hashchange', exitImmersive);

  function reveal() {
    if (revealed || !ui) return;
    revealed = true;
    ui.flip.classList.add('is-flipped'); ui.back.removeAttribute('aria-hidden');
    ui.showWrap.hidden = true; ui.rate.hidden = false;
    ui.hint.textContent = 'Rate honestly. The time under each button is when the card returns.';
  }

  const cardFace = (label, text, cls) => {
    const f = h('div', `nx-m3-card-face nx-m3-flip-face ${cls}`);
    f.append(h('span', 'nx-kicker', label), h('p', 'nx-m3-face-text', text));
    return f;
  };

  function reviewPanel(cards) {
    const panel = h('section', 'nx-m3-panel nx-m3-review');
    panel.setAttribute('aria-label', 'Review session'); ui = null;
    const found = queue[0] ? findCard(queue[0]) : null;
    if (!found) {
      const empty = h('div', 'nx-m3-empty');
      empty.append(
        h('h2', 'nx-m3-title', cards.length ? 'You are all caught up.' : 'No cards yet.'),
        h('p', 'nx-m3-sub', cards.length ? 'Nothing is due right now. Add cards or come back later.' : 'Generate cards from a Vault note, add one by hand, or paste a list.'));
      const row = h('div', 'nx-m3-actions nx-m3-actions-center');
      if (immersive) { const x = h('button', 'nx-primary-button', 'Exit full screen'); x.type = 'button'; x.onclick = exitImmersive; row.append(x); }
      else if (dueCards().length) {
        const b = h('button', 'nx-primary-button', 'Start review'); b.type = 'button'; b.onclick = () => { startQueue(); render(); };
        const f = h('button', 'nx-secondary-button', 'Start in full screen'); f.type = 'button'; f.onclick = () => { startQueue(); enterImmersive(); };
        row.append(b, f);
      }
      if (row.children.length) empty.append(row);
      panel.append(empty);
      return panel;
    }
    const { card: current, deck } = found;
    const meta = h('div', 'nx-m3-meta'); const right = h('div', 'nx-m3-meta-end');
    const fsBtn = h('button', 'nx-m3-btn-ghost', immersive ? 'Exit full screen' : 'Full screen'); fsBtn.type = 'button';
    fsBtn.setAttribute('aria-pressed', String(immersive));
    fsBtn.title = immersive ? 'Leave full screen (Esc)' : 'Distraction-free full-screen review';
    fsBtn.onclick = () => (immersive ? exitImmersive() : enterImmersive());
    right.append(h('span', '', `${queue.length} left`), fsBtn);
    meta.append(h('span', 'nx-m3-pill', deck.title), right);
    panel.append(meta, NexoraProgress(sessionTotal ? (sessionTotal - queue.length) / sessionTotal : 0, 'Session progress'));

    // Card with both faces rendered once, so revealing is a CSS flip rather than a re-render.
    const flip = h('div', revealed ? 'nx-m3-flip nx-m3-card-enter is-flipped' : 'nx-m3-flip nx-m3-card-enter');
    const inner = h('div', 'nx-m3-flip-inner');
    const front = cardFace('Question', current.front, 'nx-m3-flip-front');
    const back = cardFace('Answer', current.back, 'nx-m3-flip-back nx-m3-answer');
    if (!revealed) back.setAttribute('aria-hidden', 'true');
    inner.append(front, back); flip.append(inner);

    const showWrap = h('div', 'nx-m3-actions nx-m3-actions-center'); showWrap.hidden = revealed;
    const showBtn = h('button', 'nx-primary-button nx-m3-btn-lg', 'Show answer'); showBtn.type = 'button'; showBtn.onclick = reveal;
    showWrap.append(showBtn);

    const rateRow = h('div', 'nx-m3-rate'); rateRow.hidden = !revealed;
    RATINGS.forEach(([name, rating, q], i) => {
      const b = h('button', `nx-m3-rate-btn nx-m3-rate-${rating}`); b.type = 'button';
      b.setAttribute('aria-keyshortcuts', String(i + 1));
      b.append(h('strong', '', name), h('small', '', `${daysLabel(schedule(current, q).intervalDays)} · key ${i + 1}`));
      b.onclick = () => rate(current.id, rating, q);
      rateRow.append(b);
    });
    const hint = h('p', 'nx-m3-hint', revealed ? 'Rate honestly. The time under each button is when the card returns.' : 'Press Space to flip the card.');
    ui = { flip, back, showWrap, rate: rateRow, hint };
    panel.append(flip, showWrap, rateRow, hint);
    return panel;
  }

  // ---- Generate cards from the Vault (API) ---------------------------------
  async function refreshVaultFiles() {
    try {
      const store = window.NexoraVaultFileStore;
      if (store?.list) vaultFiles = (await store.list()).filter(f => f.type === 'text/plain' || f.type === 'application/pdf' || /\.(txt|pdf)$/i.test(f.name || '')).map(f => ({ id: f.id, name: f.name }));
    } catch (_) { vaultFiles = []; }
    if (!root.hidden && !gen.busy) render();
  }

  const vaultNotes = () => S.get('nexora-vault-notes', []).filter(n => n && n.id && Array.isArray(n.sections));

  async function loadSource(value) {
    const [kind, ...rest] = String(value).split(':'); const id = rest.join(':');
    if (kind === 'note') {
      const note = vaultNotes().find(n => n.id === id);
      if (!note) throw new Error('That study guide is no longer in your Vault.');
      const sections = note.sections.map(sec => ({ heading: sec.heading, points: sec.points || [] }));
      return {
        id: note.id, title: note.title || 'Vault notes',
        payload: { title: note.title, overview: note.overview, sections, takeaways: note.takeaways || [] },
        local: sections.filter(sec => sec.heading && sec.points.length).map(sec => ({ front: sec.heading, back: sec.points.join('\n') })),
      };
    }
    if (kind === 'file') {
      const rec = await window.NexoraVaultFileStore?.get(id);
      if (!rec?.blob) throw new Error('Could not open that file from the Vault.');
      const title = String(rec.name || 'Vault file').replace(/\.(txt|pdf)$/i, '');
      if (rec.type === 'application/pdf' || /\.pdf$/i.test(rec.name || '')) {
        if (rec.blob.size > 10 * 1024 * 1024) throw new Error('That PDF is larger than 10 MB. Try a smaller file.');
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Could not read that PDF.')); r.readAsDataURL(rec.blob);
        });
        return { id: rec.id, title, payload: { title: rec.name }, file: { mimeType: 'application/pdf', data }, local: [] };
      }
      const text = (await rec.blob.text()).slice(0, 20000);
      if (text.trim().length < 60) throw new Error('That file has too little text to make cards from.');
      return { id: rec.id, title, payload: { title: rec.name, text }, local: [] };
    }
    throw new Error('Choose a note or file first.');
  }

  // Calls the backend. `fallbackOk` marks failures where building cards locally is a reasonable substitute.
  async function requestCards(payload, count, file) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), file ? 130000 : 45000);
    let res;
    try {
      res = await fetch('/api/flashloop/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: payload, count, file }), signal: ctrl.signal });
    } catch (e) {
      const err = new Error(e.name === 'AbortError' ? 'Generation took too long.' : 'Could not reach the Nexora server. Run npm start and open Nexora from it.');
      err.fallbackOk = true; throw err;
    } finally { clearTimeout(timer); }
    let data = null; try { data = await res.json(); } catch (_) { /* e.g. an HTML 404 page */ }
    if (!res.ok) {
      const err = new Error(data?.error || (res.status === 404 ? 'The server has no /api/flashloop/generate route yet (check server/index.js, save, and restart npm start).' : `The server returned ${res.status}.`));
      err.fallbackOk = res.status === 404 || res.status >= 500; throw err;
    }
    const cards = Array.isArray(data?.cards) ? data.cards.filter(c => c && typeof c.front === 'string' && typeof c.back === 'string' && c.front.trim() && c.back.trim()) : [];
    if (!cards.length) { const err = new Error('The server returned no usable cards.'); err.fallbackOk = true; throw err; }
    return { cards, provider: data.provider };
  }

  async function generateFromVault() {
    if (gen.busy) return;
    if (!gen.source) { gen.error = 'Choose a note or file first.'; gen.info = ''; return render(); }
    gen.busy = true; gen.error = ''; gen.info = ''; render();
    try {
      const src = await loadSource(gen.source);
      let cards, usedLocal = false, provider = '';
      let reason = '';
      try { ({ cards, provider } = await requestCards(src.payload, gen.count, src.file)); }
      catch (err) {
        if (err.fallbackOk && src.local.length) { cards = src.local; usedLocal = true; reason = err.message; }
        else throw new Error(err.fallbackOk ? `${err.message} Nothing was added.` : err.message);
      }
      const added = addCards(src.title, src.id, cards.map(c => [c.front.trim(), c.back.trim()]), true);
      const skipped = cards.length - added;
      gen.info = `${added} card${added === 1 ? '' : 's'} added to "${src.title}"${skipped ? ` (${skipped} already in the deck)` : ''}.`
        + (usedLocal ? ` AI generation failed (${reason}) so these were built from the note\u2019s headings and points.` : provider ? ` Written by ${provider}.` : '');
      say(`${added} card${added === 1 ? '' : 's'} added.`);
    } catch (problem) { gen.error = problem.message || 'Could not generate cards.'; }
    finally { gen.busy = false; render(); root.querySelector('[data-nx-gen]')?.focus(); }
  }

  function generatePanel() {
    const notes = vaultNotes();
    const hasSources = notes.length > 0 || vaultFiles.length > 0;
    const form = h('form', 'nx-m3-panel');
    form.append(panelHead('Generate from Vault', 'Pick a saved study guide and AI drafts the cards for you.'));
    if (!hasSources) {
      form.append(h('p', 'nx-m3-note', 'Your Vault has no study guides, PDFs or text files yet. Upload a file in Vault or save notes from the One-Shot Summarizer, then come back.'));
      return form;
    }
    const select = h('select'); select.disabled = gen.busy;
    select.append(Object.assign(h('option', '', 'Choose a note or file…'), { value: '' }));
    const group = (label, items) => { if (!items.length) return; const g = h('optgroup'); g.label = label; items.forEach(([v, t]) => g.append(Object.assign(h('option', '', t), { value: v }))); select.append(g); };
    group('Study guides', notes.map(n => [`note:${n.id}`, `${n.title || 'Untitled'} · ${n.sections.length} sections`]));
    group('Vault files (PDF and text)', vaultFiles.map(f => [`file:${f.id}`, f.name]));
    select.value = [...select.options].some(o => o.value === gen.source) ? gen.source : ''; gen.source = select.value;
    select.onchange = () => { gen.source = select.value; gen.error = ''; };
    const count = h('select'); count.disabled = gen.busy;
    [8, 12, 20].forEach(n => count.append(Object.assign(h('option', '', `${n} cards`), { value: String(n) })));
    count.value = String(gen.count); count.onchange = () => { gen.count = Number(count.value) || 12; };
    const btn = h('button', 'nx-primary-button nx-m3-btn-wrap', gen.busy ? 'Generating cards from your Vault…' : 'Generate from Vault');
    btn.type = 'submit'; btn.disabled = gen.busy; btn.setAttribute('data-nx-gen', ''); btn.setAttribute('aria-busy', String(gen.busy));
    if (gen.busy) btn.prepend(h('i', 'nx-m3-spinner'));
    form.append(NexoraField('Vault source', select), NexoraField('How many cards', count), btn);
    if (gen.busy) { const isFile = String(gen.source).startsWith('file:');
    const p = h('p', 'nx-m3-banner', isFile ? 'Reading your file and writing questions. A PDF can take up to two minutes, so keep this tab open.' : 'Reading your notes and writing questions. This can take up to half a minute.'); p.setAttribute('role', 'status'); form.append(p); }
    if (gen.error) { const p = h('p', 'nx-m3-banner is-error', gen.error); p.setAttribute('role', 'alert'); form.append(p); }
    if (gen.info) { const p = h('p', 'nx-m3-banner', gen.info); p.setAttribute('role', 'status'); form.append(p); }
    form.onsubmit = e => { e.preventDefault(); generateFromVault(); };
    return form;
  }

  function addPanel(decks) {
    const form = h('form', 'nx-m3-panel');
    form.append(panelHead('Add cards', 'Type one card, or paste many at once.'));
    const deckField = h('input'); deckField.placeholder = 'e.g. Design Patterns'; deckField.maxLength = 60;
    const list = h('datalist'); list.id = 'nx-m3-decklist'; decks.forEach(d => list.append(Object.assign(h('option'), { value: d.title })));
    deckField.setAttribute('list', list.id);
    const front = h('textarea'); front.rows = 2; front.placeholder = 'What is the question?';
    const back = h('textarea'); back.rows = 2; back.placeholder = 'What is the answer?';
    const bulk = h('textarea'); bulk.rows = 4; bulk.placeholder = 'question :: answer\nanother question :: another answer';
    const fold = h('details', 'nx-m3-fold'); fold.append(h('summary', '', 'Paste many cards'));
    const foldBody = h('div', 'nx-m3-fold-body');
    foldBody.append(NexoraField('One card per line', bulk, 'Use two colons between front and back.')); fold.append(foldBody);
    const save = h('button', 'nx-primary-button', 'Add cards'); save.type = 'submit';
    const imp = h('button', 'nx-secondary-button', 'Quick import (no AI)'); imp.type = 'button';
    const actions = h('div', 'nx-m3-actions'); actions.append(save, imp);
    form.append(NexoraField('Deck', deckField), NexoraField('Front', front), NexoraField('Back', back), fold, actions);
    form.onsubmit = e => {
      e.preventDefault();
      const name = deckField.value.trim() || 'General';
      const fresh = [];
      if (front.value.trim() && back.value.trim()) fresh.push([front.value.trim(), back.value.trim()]);
      bulk.value.split('\n').forEach(line => { const [f, ...r] = line.split('::'); if (f.trim() && r.join('::').trim()) fresh.push([f.trim(), r.join('::').trim()]); });
      if (!fresh.length) return say('Enter a front and back, or paste lines as question :: answer.');
      const n = addCards(name, null, fresh);
      say(`${n} card${n === 1 ? '' : 's'} added.`);
    };
    imp.onclick = () => {
      const notes = S.get('nexora-vault-notes', []);
      let n = 0;
      notes.forEach(note => {
        const fresh = (note.sections || []).filter(s => s.heading && (s.points || []).length).map(s => [s.heading, s.points.join('\n')]);
        n += addCards(note.title || 'Vault notes', note.id || null, fresh, true);
      });
      say(n ? `${n} cards imported from Vault notes.` : 'No new Vault notes to import. Save notes from the Summarizer first.');
      render();
    };
    return form;
  }

  function decksPanel(decks, now) {
    const list = h('section', 'nx-m3-panel');
    list.append(panelHead('Decks', 'Cards due now are counted per deck.'));
    if (!decks.length) { list.append(h('p', 'nx-m3-note', 'No decks yet. Add your first cards above.')); return list; }
    const body = h('div', 'nx-m3-scroll');
    decks.forEach(d => {
      const dueN = d.cards.filter(c => new Date(c.dueAt).getTime() <= now).length;
      const r = h('div', 'nx-m3-row'); const main = h('div', 'nx-m3-row-main');
      main.append(h('strong', '', d.title), h('small', '', `${d.cards.length} card${d.cards.length === 1 ? '' : 's'}`));
      const badge = h('span', dueN ? 'nx-m3-badge nx-m3-badge-warn' : 'nx-m3-badge', dueN ? `${dueN} due` : 'None due');
      const del = h('button', 'nx-m3-btn-ghost nx-m3-btn-danger', 'Delete'); del.type = 'button';
      del.setAttribute('aria-label', `Delete deck ${d.title}`);
      del.onclick = () => { if (confirm(`Delete "${d.title}" and its ${d.cards.length} cards?`)) { saveDecks(loadDecks().filter(x => x.id !== d.id)); startQueue(); render(); } };
      r.append(main, badge, del); body.append(r);
    });
    list.append(body);
    return list;
  }

  function render() {
    const decks = loadDecks();
    const cards = allCards();
    const now = Date.now();
    const due = cards.filter(c => new Date(c.dueAt).getTime() <= now).length;

    root.replaceChildren();
    const header = h('header', 'nx-m3-header');
    const title = h('h1', '', 'Recall it just before you forget it.'); title.id = 'nx-flashloop-title';
    header.append(h('p', 'nx-eyebrow', 'Study workspace / FlashLoop'), title,
      h('p', 'nx-module-description', 'Cards come back on a spaced schedule (SM-2). Rate each one honestly and FlashLoop decides when you see it next.'));

    const stats = h('section', 'nx-m3-stats nx-m3-stats-3'); stats.setAttribute('aria-label', 'Deck summary');
    stats.append(stat('Due now', due, 'Ready to review'), stat('New', cards.filter(c => c.repetitions === 0).length, 'Never reviewed'), stat('Total cards', cards.length, `${decks.length} deck${decks.length === 1 ? '' : 's'}`));

    const side = h('div', 'nx-m3-stack'); side.append(generatePanel(), addPanel(decks), decksPanel(decks, now));
    const layout = h('div', 'nx-m3-layout'); layout.append(reviewPanel(cards), side);
    root.append(header, stats, layout);
  }

  function addCards(deckTitle, sourceId, pairs, silent) {
    const decks = loadDecks();
    let deck = decks.find(d => d.title === deckTitle);
    if (!deck) { deck = { id: crypto.randomUUID(), title: deckTitle, sourceId, createdAt: D.isoNow(), cards: [] }; decks.push(deck); }
    const seen = new Set(deck.cards.map(c => c.front));
    let n = 0;
    pairs.forEach(([front, back]) => {
      if (seen.has(front)) return;
      deck.cards.push({
        id: crypto.randomUUID(), deckId: deck.id, front, back, sourceId: sourceId || null,
        repetitions: 0, intervalDays: 0, easiness: 2.5, dueAt: D.isoNow(), lastReviewedAt: null, createdAt: D.isoNow(),
      });
      n++;
    });
    saveDecks(decks); startQueue(); if (!silent) render();
    return n;
  }

  function rate(cardId, rating, q) {
    const found = findCard(cardId); if (!found) return;
    const { card, deck } = found;
    Object.assign(card, schedule(card, q));
    const reviewedAt = D.isoNow();
    card.dueAt = nextDueAt(card.intervalDays);
    card.lastReviewedAt = reviewedAt;
    saveDecks(loadDecks());

    const reviews = S.get(REVIEWS_KEY, []);
    reviews.push({ id: crypto.randomUUID(), cardId: card.id, deckId: deck.id, rating, reviewedAt, nextDueAt: card.dueAt });
    S.set(REVIEWS_KEY, reviews.slice(-5000));
    window.dispatchEvent(new CustomEvent('nexora:flashcard-reviewed', { detail: { cardId: card.id, deckId: deck.id, rating, reviewedAt, nextDueAt: card.dueAt } }));

    queue.shift(); if (q < 3) queue.push(card.id); // "Again" comes back this session
    revealed = false; render();
  }

  document.addEventListener('keydown', e => {
    if (root.hidden) return;
    if (e.key === 'Escape' && immersive) { exitImmersive(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !queue[0]) return;
    if (e.key === ' ' && !revealed) { e.preventDefault(); reveal(); }
    else if (revealed && e.key.length === 1 && '1234'.includes(e.key)) rate(queue[0], RATINGS[Number(e.key) - 1][1], RATINGS[Number(e.key) - 1][2]);
  });

  migrateLegacyCards();
  window.addEventListener('nexora:vault-updated', refreshVaultFiles);
  NexoraRegisterPage('flashloop', root, () => { startQueue(); render(); refreshVaultFiles(); });
})();
