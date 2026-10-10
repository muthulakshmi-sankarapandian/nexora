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

  // Stored data is untrusted: coerce it into a safe shape so one bad record can never crash the module.
  const num = (v, d, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : d);
  const validDate = v => (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : D.isoNow());
  function sanitizeDecks(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(d => d && typeof d === 'object' && d.id).map(d => ({
      ...d, title: String(d.title || 'Untitled deck'),
      cards: (Array.isArray(d.cards) ? d.cards : []).filter(c => c && c.id && typeof c.front === 'string' && typeof c.back === 'string').map(c => ({
        ...c, deckId: d.id, repetitions: Math.floor(num(c.repetitions, 0)), intervalDays: Math.floor(num(c.intervalDays, 0)),
        easiness: num(c.easiness, 2.5, 1.3), dueAt: validDate(c.dueAt),
      })),
    }));
  }
  const loadDecks = () => { try { return sanitizeDecks(S.get(DECKS_KEY, [])); } catch (_) { return []; } };
  const saveDecks = decks => {
    let ok = false; try { ok = S.set(DECKS_KEY, decks); } catch (_) { ok = false; }
    if (!ok) say('Browser storage is full or unavailable. Export a deck to CSV to keep a copy.');
    return ok;
  };
  const allCards = () => loadDecks().flatMap(d => d.cards.map(c => ({ ...c, deckTitle: d.title })));
  // Which deck is being reviewed ('' = all decks). Remembered between visits.
  const UI_KEY = 'nexora-flashloop-ui';
  let activeDeck = S.get(UI_KEY, {}).activeDeck || '';
  const setActiveDeck = id => { activeDeck = id || ''; S.set(UI_KEY, { activeDeck }); };
  const inScope = c => !activeDeck || c.deckId === activeDeck;
  const isDue = c => new Date(c.dueAt).getTime() <= Date.now();
  const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const dueCards = () => allCards().filter(inScope).filter(isDue);
  // ---- Size safeguards + text helpers ----------------------------------------
  // Tune these if your server accepts bigger bodies (see express.json({ limit }) in server/index.js).
  const LIMITS = {
    CHUNK_CHARS: 5000,               // text per generation request
    MAX_CHUNKS: 5,                   // chunks sent per run, sampled evenly across the text
    MAX_SOURCE_CHARS: 60000,         // text read from a file or selection before chunking
    NOTE_JSON_MAX: 24000,            // Vault notes bigger than this go out as chunked text
    PDF_MAX_BYTES: 4 * 1024 * 1024,  // base64 adds ~33%; keep the request under the server body limit
    READER_MAX_CHARS: 200000,        // text shown in the select-and-make-cards reader
    SELECTION_MAX_CARDS: 25,
  };
  const normText = t => String(t || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const noteToText = n => [n.title, n.overview,
    ...(n.sections || []).map(sec => `${sec.heading}\n${(sec.points || []).map(p => `- ${p}`).join('\n')}`),
    ...(n.takeaways?.length ? ['Key takeaways\n' + n.takeaways.map(t => `- ${t}`).join('\n')] : [])].filter(Boolean).join('\n\n');

  // Pack paragraphs (then sentences, then raw slices) into chunks <= size. Too many chunks? Sample evenly so the whole text is represented.
  function chunkText(text, size = LIMITS.CHUNK_CHARS, maxChunks = LIMITS.MAX_CHUNKS) {
    const pieces = [];
    normText(text).split(/\n\s*\n/).forEach(par => {
      if (par.length <= size) { pieces.push(par); return; }
      par.split(/(?<=[.!?])\s+/).forEach(sen => { for (let i = 0; i < sen.length; i += size) pieces.push(sen.slice(i, i + size)); });
    });
    const chunks = []; let cur = '';
    pieces.forEach(piece => {
      if (cur && cur.length + piece.length + 2 > size) { chunks.push(cur); cur = ''; }
      cur += (cur ? '\n\n' : '') + piece;
    });
    if (cur) chunks.push(cur);
    if (chunks.length <= maxChunks) return { chunks, truncated: false };
    const picked = Array.from({ length: maxChunks }, (_, i) => chunks[Math.round(i * (chunks.length - 1) / Math.max(1, maxChunks - 1))]);
    return { chunks: picked, truncated: true };
  }
  const splitCount = (total, parts) => Array.from({ length: parts }, (_, i) => Math.max(1, Math.floor(total / parts) + (i < total % parts ? 1 : 0)));

  // No-AI fallback: term/definition lines, heading + bullets, "X is …" sentences, then fill-in-the-blank sentences.
  function localCards(text, max = 25) {
    const out = [], seen = new Set();
    const push = (front, back) => {
      front = front.trim(); back = back.trim(); const key = front.toLowerCase();
      if (out.length >= max || front.length < 4 || back.length < 4 || seen.has(key)) return;
      seen.add(key); out.push({ front: front.slice(0, 300), back: back.slice(0, 900) });
    };
    const clean = normText(text), lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach(l => {
      const m = l.match(/^[-•*\d.)\s]*(.{2,60}?)\s*(::|:| — | – | - )\s+(.{8,})$/);
      if (m) push(m[2] === '::' ? m[1] : `What is ${m[1].replace(/[?.]$/, '')}?`, m[3]);
    });
    for (let i = 0; i < lines.length && out.length < max; i++) {
      const head = lines[i].replace(/^#+\s*/, '');
      if (head.length > 80 || /[.!?:]$/.test(head) || /^[-•*\d]/.test(lines[i])) continue;
      const body = []; let j = i + 1;
      while (j < lines.length && body.length < 6 && /^([-•*]|\d+[.)])\s/.test(lines[j])) body.push(lines[j++].replace(/^([-•*]|\d+[.)])\s+/, ''));
      if (body.length) { push(head, body.join('\n')); i = j - 1; }
    }
    const sentences = lines.filter(l => !/^([-•*]|\d+[.)])\s/.test(l)).flatMap(l => l.split(/(?<=[.!?])\s+/));
    sentences.forEach(sen => {
      const m = sen.match(/^(?:(?:An?|The)\s+)?([A-Za-z][\w\s\-/()]{2,60}?)\s+(is|are|refers to|means|is defined as|can be defined as)\s+(.{12,})$/);
      if (m && !/^(it|this|that|there|he|she|they|which|what)$/i.test(m[1].trim())) push(`${m[2] === 'are' ? 'What are' : 'What is'} ${m[1].trim()}?`, sen);
    });
    sentences.forEach(sen => {
      if (sen.length < 50 || sen.length > 280) return;
      const words = sen.match(/[A-Za-z][A-Za-z-]{6,}/g); if (!words) return;
      const key = words.sort((x, y) => y.length - x.length)[0];
      push(sen.replace(key, '_____'), `${key}\n\n${sen}`);
    });
    return out;
  }
  const stripExt = name => String(name || '').replace(/(\.(pptx?|pdf|txt|docx?))+$/i, '');

  const RATINGS = [['Again', 'again', 1], ['Hard', 'hard', 3], ['Good', 'good', 4], ['Easy', 'easy', 5]];
  const schedule = (card, q) => {
    let easiness = num(card.easiness, 2.5, 1.3), intervalDays = num(card.intervalDays, 0), repetitions = num(card.repetitions, 0);
    if (q < 3) { repetitions = 0; intervalDays = 0; } // early retry, same session
    else {
      repetitions += 1;
      intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round(intervalDays * easiness));
      easiness = Math.max(1.3, easiness + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    }
    return { easiness, intervalDays, repetitions };
  };
  const nextDueAt = interval => interval === 0 ? new Date().toISOString() : new Date(Date.now() + interval * 86400000).toISOString();
  const daysLabel = d => (d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);

  let queue = [], revealed = false, sessionTotal = 0;
  let immersive = false, usedFullscreenApi = false, ui = null; // ui = handles to the current card's DOM
  const gen = { busy: false, source: '', count: 12, error: '', info: '', from: 'vault' };
  let vaultFiles = [];
  let manageDeckId = '', editingCardId = '', renamingDeck = false, manageQuery = '', lastAddedDeckId = '';
  // ahead=true: practise the 20 soonest-due cards of the selected deck even when nothing is due yet.
  const startQueue = (ahead = false) => {
    queue = ahead
      ? allCards().filter(inScope).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 20).map(c => c.id)
      : dueCards().map(c => c.id);
    sessionTotal = queue.length; revealed = false;
  };

  const root = h('section', 'nx-module-view nx-m3');
  root.id = 'nx-flashloop';
  root.setAttribute('aria-labelledby', 'nx-flashloop-title');

  function findCard(id) { const decks = loadDecks(); for (const d of decks) { const c = d.cards.find(x => x.id === id); if (c) return { card: c, deck: d, decks }; } return null; }

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

  // ---- Card feel: hover tilt, glare, lift and drag-to-flip (vanilla port of React Bits FlipCard) ----
  // Dragging past ~1/3 of the card reveals the answer; a plain click or tap does too. Nothing here changes
  // scheduling: reveal() and rate() stay the only way a card advances. Skipped for reduced-motion users.
  const prefersReduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function enhanceCard(flip, inner) {
    const TILT = 9, LIFT = 1.025, SLOP = 6;
    const glare = h('span', 'nx-m3-glare'); glare.setAttribute('aria-hidden', 'true');
    flip.classList.add('nx-m3-fx'); flip.append(glare);
    const setVars = (tx, ty, tz, g) => { flip.style.setProperty('--tx', `${tx}deg`); flip.style.setProperty('--ty', `${ty}deg`); flip.style.setProperty('--tz', String(tz)); flip.style.setProperty('--glare', String(g)); };
    let grip = null;
    flip.addEventListener('pointermove', e => {
      if (grip || prefersReduced() || e.pointerType === 'touch') return;
      const r = flip.getBoundingClientRect(); if (!r.width || !r.height) return;
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      flip.style.setProperty('--gx', `${px * 100}%`); flip.style.setProperty('--gy', `${py * 100}%`);
      setVars(((0.5 - py) * 2 * TILT).toFixed(2), ((px - 0.5) * 2 * TILT).toFixed(2), LIFT, 1);
    });
    flip.addEventListener('pointerleave', () => { if (!grip) setVars(0, 0, 1, 0); });
    flip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || revealed || grip) return;
      grip = { id: e.pointerId, x: e.clientX, w: flip.getBoundingClientRect().width || 300, moved: false, deg: 0 };
      try { flip.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (!prefersReduced()) setVars(0, 0, LIFT, 0);
    });
    flip.addEventListener('pointermove', e => {
      if (!grip || grip.id !== e.pointerId || prefersReduced()) return;
      const dx = e.clientX - grip.x;
      if (!grip.moved && Math.abs(dx) < SLOP) return;
      if (!grip.moved) { grip.moved = true; flip.classList.add('is-dragging'); setVars(0, 0, LIFT, 0); }
      grip.deg = Math.max(-180, Math.min(180, dx / grip.w * 180));
      inner.style.transform = `rotateY(${grip.deg}deg)`;
    });
    const finish = (e, cancelled) => {
      if (!grip || grip.id !== e.pointerId) return;
      const g = grip; grip = null;
      try { if (flip.hasPointerCapture(e.pointerId)) flip.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      flip.classList.remove('is-dragging'); inner.style.transform = '';
      if (e.pointerType === 'touch' || !flip.matches(':hover')) setVars(0, 0, 1, 0);
      if (cancelled) return;
      if (!g.moved || Math.abs(g.deg) > 60) reveal(); // click/tap, or a drag far enough to count as a flip
    };
    flip.addEventListener('pointerup', e => finish(e, false));
    flip.addEventListener('pointercancel', e => finish(e, true));
  }

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
    const bar = deckBar(); if (bar) panel.append(bar);
    const found = queue[0] ? findCard(queue[0]) : null;
    if (!found) {
      const scopeName = activeDeck ? loadDecks().find(d => d.id === activeDeck)?.title : '';
      const empty = h('div', 'nx-m3-empty');
      empty.append(
        h('h2', 'nx-m3-title', cards.length ? 'You are all caught up.' : (scopeName ? 'This deck has no cards yet.' : 'No cards yet.')),
        h('p', 'nx-m3-sub', cards.length ? `Nothing is due${scopeName ? ` in "${scopeName}"` : ''} right now. Switch decks, review ahead, or come back later.` : 'Generate cards from a Vault note, add one by hand, or paste a list.'));
      const row = h('div', 'nx-m3-actions nx-m3-actions-center');
      if (immersive) { const x = h('button', 'nx-primary-button', 'Exit full screen'); x.type = 'button'; x.onclick = exitImmersive; row.append(x); }
      else if (dueCards().length) {
        const b = h('button', 'nx-primary-button', 'Start review'); b.type = 'button'; b.onclick = () => { startQueue(); render(); };
        const f = h('button', 'nx-secondary-button', 'Start in full screen'); f.type = 'button'; f.onclick = () => { startQueue(); enterImmersive(); };
        row.append(b, f);
      } else if (cards.length) {
        const ahead = h('button', 'nx-secondary-button', 'Review ahead (next 20 cards)'); ahead.type = 'button';
        ahead.onclick = () => { startQueue(true); render(); };
        row.append(ahead);
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
    enhanceCard(flip, inner);

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
      if (store?.list) vaultFiles = (await store.list()).filter(f => f.type === 'text/plain' || f.type === 'application/pdf' || /\.(txt|pdf)$/i.test(f.name || '')).map(f => ({ id: f.id, name: f.name, type: f.type }));
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
      const title = stripExt(rec.name) || 'Vault file';
      if (rec.type === 'application/pdf' || /\.pdf$/i.test(rec.name || '')) {
        if (rec.blob.size > LIMITS.PDF_MAX_BYTES) throw new Error(`That PDF is larger than ${Math.round(LIMITS.PDF_MAX_BYTES / 1048576)} MB. Try a smaller file, or save it as .txt and use Select & make cards.`);
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('Could not read that PDF.')); r.readAsDataURL(rec.blob);
        });
        return { id: rec.id, title, payload: { title: rec.name }, file: { mimeType: 'application/pdf', data }, local: [] };
      }
      const text = normText(await rec.blob.slice(0, LIMITS.MAX_SOURCE_CHARS * 4).text()).slice(0, LIMITS.MAX_SOURCE_CHARS);
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
      const err = new Error(data?.error || (res.status === 413 ? 'That was too large for the server to accept.' : res.status === 404 ? 'The server has no /api/flashloop/generate route yet (check server/index.js, save, and restart npm start).' : `The server returned ${res.status}.`));
      err.fallbackOk = res.status === 404 || res.status === 413 || res.status >= 500; throw err;
    }
    const cards = Array.isArray(data?.cards) ? data.cards.filter(c => c && typeof c.front === 'string' && typeof c.back === 'string' && c.front.trim() && c.back.trim()) : [];
    if (!cards.length) { const err = new Error('The server returned no usable cards.'); err.fallbackOk = true; throw err; }
    return { cards, provider: data.provider };
  }

  // Sends long text as several small requests (one per chunk). If the server is unreachable, falls back to local cards.
  async function requestChunked(text, title, count) {
    const { chunks, truncated } = chunkText(text);
    if (!chunks.length) throw new Error('There is no text to make cards from.');
    const counts = splitCount(count, chunks.length), cards = []; let provider = '', usedLocal = false, reason = '';
    for (let i = 0; i < chunks.length; i++) {
      if (!usedLocal) {
        try { const r = await requestCards({ title, text: chunks[i] }, counts[i]); cards.push(...r.cards); provider = r.provider || provider; continue; }
        catch (err) { if (!err.fallbackOk) throw err; usedLocal = true; reason = err.message; }
      }
      cards.push(...localCards(chunks[i], counts[i]));
    }
    const seen = new Set(), unique = cards.filter(c => { const k = c.front.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!unique.length) throw new Error('No cards could be made from that text. Try a longer or more structured passage.');
    return { cards: unique.slice(0, count), provider, usedLocal, reason, truncated };
  }

  // One entry point for Vault sources and selections. src = { id, title, payload, file?, local }.
  async function produceCards(src, count) {
    const text = src.file ? '' : typeof src.payload.text === 'string' ? src.payload.text
      : JSON.stringify(src.payload).length > LIMITS.NOTE_JSON_MAX ? noteToText(src.payload) : '';
    try {
      if (text) return await requestChunked(text, src.title, count);
      const r = await requestCards(src.payload, count, src.file);
      return { cards: r.cards, provider: r.provider, usedLocal: false, reason: '', truncated: false };
    } catch (err) {
      if (!err.fallbackOk) throw err;
      const local = src.local?.length ? src.local : localCards(text, count);
      if (!local.length) throw new Error(`${err.message} Nothing was added.`);
      return { cards: local.slice(0, count), usedLocal: true, reason: err.message, truncated: false };
    }
  }

  function addGenerated(src, res) {
    const added = addCards(src.title, src.id, res.cards.map(c => [c.front.trim(), c.back.trim()]), true);
    if (lastAddedDeckId) { setActiveDeck(lastAddedDeckId); startQueue(); }
    const skipped = res.cards.length - added;
    gen.info = `${added} card${added === 1 ? '' : 's'} added to "${src.title}"${skipped ? ` (${skipped} already in the deck)` : ''}.`
      + (res.truncated ? ' The text was very long, so evenly spaced parts of it were used.' : '')
      + (res.usedLocal ? ` AI generation failed (${res.reason}) so these were built locally from the text.` : res.provider ? ` Written by ${res.provider}.` : '');
    say(`${added} card${added === 1 ? '' : 's'} added.`);
  }

  async function generateFromVault() {
    if (gen.busy) return;
    gen.from = 'vault';
    if (!gen.source) { gen.error = 'Choose a note or file first.'; gen.info = ''; return render(); }
    gen.busy = true; gen.error = ''; gen.info = ''; render();
    try { const src = await loadSource(gen.source); addGenerated(src, await produceCards(src, gen.count)); }
    catch (problem) { gen.error = problem.message || 'Could not generate cards.'; }
    finally { gen.busy = false; render(); root.querySelector('[data-nx-gen]')?.focus(); }
  }

  // ---- Select & make cards: highlight text in the reader, then generate up to 25 cards ----
  const reader = { key: '', title: '', id: null, text: '', error: '', view: null };
  const sel = { text: '', count: 10, btn: null, info: null };
  const floatBtn = h('button', 'nx-primary-button nx-m3-float-action', 'Make flashcards'); floatBtn.type = 'button'; floatBtn.hidden = true;
  floatBtn.addEventListener('mousedown', e => e.preventDefault()); // keep the highlight while clicking
  floatBtn.addEventListener('click', () => generateFromSelection());

  async function loadReader(value) {
    reader.error = ''; sel.text = '';
    try {
      if (!value) Object.assign(reader, { key: '', title: '', id: null, text: '' });
      else {
        const [kind, ...rest] = value.split(':'); const id = rest.join(':');
        if (kind === 'note') {
          const n = vaultNotes().find(x => x.id === id); if (!n) throw new Error('That study guide is no longer in your Vault.');
          Object.assign(reader, { key: value, title: n.title || 'Vault notes', id: n.id, text: noteToText(n) });
        } else if (kind === 'file') {
          const rec = await window.NexoraVaultFileStore?.get(id); if (!rec?.blob) throw new Error('Could not open that file from the Vault.');
          const text = normText(await rec.blob.slice(0, LIMITS.READER_MAX_CHARS * 4).text()).slice(0, LIMITS.READER_MAX_CHARS);
          if (!text) throw new Error('That file has no readable text.');
          Object.assign(reader, { key: value, title: stripExt(rec.name) || 'Vault file', id: rec.id, text });
        }
      }
    } catch (e) { reader.error = e.message || 'Could not open that source.'; }
    render();
  }

  function readSelection() {
    if (root.hidden) return;
    const s = window.getSelection(); let text = '', rect = null;
    if (s && !s.isCollapsed && s.rangeCount && reader.view?.isConnected) {
      const r = s.getRangeAt(0);
      if (reader.view.contains(r.commonAncestorContainer)) { text = normText(s.toString()); rect = r.getBoundingClientRect(); }
    }
    if (!text && sel.text && document.activeElement === sel.btn) return; // keep the last selection while its button is being used
    sel.text = text.slice(0, LIMITS.MAX_SOURCE_CHARS);
    if (sel.btn) sel.btn.disabled = gen.busy || sel.text.length < 40;
    if (sel.info) sel.info.textContent = sel.text ? `${sel.text.length.toLocaleString()} characters selected${text.length > sel.text.length ? ' (trimmed)' : ''}` : 'Highlight a passage above.';
    if (sel.text.length >= 40 && rect && !gen.busy) {
      floatBtn.hidden = false;
      const w = floatBtn.offsetWidth || 150;
      floatBtn.style.left = `${Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
      floatBtn.style.top = `${rect.top > 56 ? rect.top - 48 : rect.bottom + 10}px`;
    } else floatBtn.hidden = true;
  }
  let selTimer = 0;
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(readSelection, 120); });
  window.addEventListener('scroll', () => { floatBtn.hidden = true; }, { passive: true });

  async function generateFromSelection() {
    if (gen.busy) return;
    gen.from = 'selection';
    if (sel.text.length < 40) { gen.error = 'Select a longer passage (at least 40 characters).'; gen.info = ''; return render(); }
    const title = reader.title || 'Selected notes', count = Math.min(LIMITS.SELECTION_MAX_CARDS, sel.count);
    const src = { id: reader.id, title, payload: { title, text: sel.text }, local: [] };
    gen.busy = true; gen.error = ''; gen.info = ''; floatBtn.hidden = true; render();
    try { addGenerated(src, await produceCards(src, count)); sel.text = ''; }
    catch (problem) { gen.error = problem.message || 'Could not generate cards.'; }
    finally { gen.busy = false; render(); root.querySelector('[data-nx-sel]')?.focus(); }
  }

  function readerPanel() {
    const panel = h('section', 'nx-m3-panel nx-m3-reader'); reader.view = null; sel.btn = null; sel.info = null;
    panel.append(panelHead('Select & make cards', 'Highlight any passage from your notes, then turn it into up to 25 cards.'));
    const textFiles = vaultFiles.filter(f => f.type === 'text/plain' || /\.txt$/i.test(f.name || ''));
    const picker = h('select'); picker.disabled = gen.busy;
    picker.append(Object.assign(h('option', '', 'Choose notes to read…'), { value: '' }));
    const group = (label, items) => { if (!items.length) return; const g = h('optgroup'); g.label = label; items.forEach(([v, t]) => g.append(Object.assign(h('option', '', t), { value: v }))); picker.append(g); };
    group('Study guides', vaultNotes().map(n => [`note:${n.id}`, n.title || 'Untitled']));
    group('Text files', textFiles.map(f => [`file:${f.id}`, f.name]));
    picker.value = [...picker.options].some(o => o.value === reader.key) ? reader.key : '';
    picker.onchange = () => loadReader(picker.value);
    const paste = h('textarea'); paste.rows = 4; paste.placeholder = 'Paste any notes here…';
    const show = h('button', 'nx-secondary-button', 'Show in reader'); show.type = 'button';
    show.onclick = () => {
      const text = normText(paste.value).slice(0, LIMITS.READER_MAX_CHARS);
      if (text.length < 40) return say('Paste a little more text first.');
      Object.assign(reader, { key: '', title: 'Pasted notes', id: null, text, error: '' }); sel.text = ''; render();
    };
    const fold = h('details', 'nx-m3-fold'); fold.append(h('summary', '', 'Or paste text'));
    const foldBody = h('div', 'nx-m3-fold-body'); foldBody.append(NexoraField('Your notes', paste), show); fold.append(foldBody);
    panel.append(NexoraField('Notes to read', picker), fold);
    if (reader.error) { const p = h('p', 'nx-m3-banner is-error', reader.error); p.setAttribute('role', 'alert'); panel.append(p); }

    if (reader.text) {
      const view = h('div', 'nx-m3-reader-text', reader.text); view.tabIndex = 0;
      view.setAttribute('role', 'region'); view.setAttribute('aria-label', `${reader.title}. Select a passage to make flashcards.`);
      reader.view = view;
      const count = h('select'); count.disabled = gen.busy;
      [5, 10, 15, 25].forEach(n => count.append(Object.assign(h('option', '', `${n} cards`), { value: String(n) })));
      count.value = String(sel.count); count.onchange = () => { sel.count = Number(count.value) || 10; };
      const btn = h('button', 'nx-primary-button nx-m3-btn-wrap', gen.busy && gen.from === 'selection' ? 'Making cards…' : 'Make cards from selection');
      btn.type = 'button'; btn.disabled = gen.busy || sel.text.length < 40; btn.setAttribute('data-nx-sel', ''); btn.setAttribute('aria-busy', String(gen.busy));
      if (gen.busy && gen.from === 'selection') btn.prepend(h('i', 'nx-m3-spinner'));
      btn.onclick = generateFromSelection;
      const info = h('p', 'nx-m3-hint', sel.text ? `${sel.text.length.toLocaleString()} characters selected` : 'Highlight a passage above.'); info.setAttribute('aria-live', 'polite');
      sel.btn = btn; sel.info = info;
      const bar = h('div', 'nx-m3-reader-bar'); bar.append(NexoraField('How many cards', count), btn);
      panel.append(view, bar, info);
    }
    if (gen.from === 'selection') {
      if (gen.busy) { const p = h('p', 'nx-m3-banner', 'Reading your selection and writing questions. Long passages are split into parts, so this can take a little while.'); p.setAttribute('role', 'status'); panel.append(p); }
      if (gen.error) { const p = h('p', 'nx-m3-banner is-error', gen.error); p.setAttribute('role', 'alert'); panel.append(p); }
      if (gen.info) { const p = h('p', 'nx-m3-banner', gen.info); p.setAttribute('role', 'status'); panel.append(p); }
    }
    return panel;
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
    [8, 12, 20, 25].forEach(n => count.append(Object.assign(h('option', '', `${n} cards`), { value: String(n) })));
    count.value = String(gen.count); count.onchange = () => { gen.count = Number(count.value) || 12; };
    const btn = h('button', 'nx-primary-button nx-m3-btn-wrap', gen.busy ? 'Generating cards from your Vault…' : 'Generate from Vault');
    btn.type = 'submit'; btn.disabled = gen.busy; btn.setAttribute('data-nx-gen', ''); btn.setAttribute('aria-busy', String(gen.busy));
    if (gen.busy) btn.prepend(h('i', 'nx-m3-spinner'));
    form.append(NexoraField('Vault source', select), NexoraField('How many cards', count), btn);
    if (gen.busy && gen.from !== 'selection') { const isFile = String(gen.source).startsWith('file:');
    const p = h('p', 'nx-m3-banner', isFile ? 'Reading your file and writing questions. A PDF can take up to two minutes, so keep this tab open.' : 'Reading your notes and writing questions. This can take up to half a minute.'); p.setAttribute('role', 'status'); form.append(p); }
    if (gen.error && gen.from !== 'selection') { const p = h('p', 'nx-m3-banner is-error', gen.error); p.setAttribute('role', 'alert'); form.append(p); }
    if (gen.info && gen.from !== 'selection') { const p = h('p', 'nx-m3-banner', gen.info); p.setAttribute('role', 'status'); form.append(p); }
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
    const activeTitle = decks.find(d => d.id === activeDeck)?.title; if (activeTitle) deckField.value = activeTitle;
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

  // ---- Deck switcher -------------------------------------------------------
  function deckBar() {
    const decks = loadDecks();
    if (!decks.length) return null;
    const wrap = h('div', 'nx-m3-deckbar');
    const sel = h('select'); const now = Date.now();
    const dueIn = d => d.cards.filter(c => new Date(c.dueAt).getTime() <= now).length;
    sel.append(Object.assign(h('option', '', `All decks (${decks.reduce((a, d) => a + dueIn(d), 0)} due)`), { value: '' }));
    decks.forEach(d => sel.append(Object.assign(h('option', '', `${d.title} (${dueIn(d)} due)`), { value: d.id })));
    sel.value = activeDeck;
    sel.onchange = () => { setActiveDeck(sel.value); startQueue(); render(); };
    wrap.append(NexoraField('Reviewing', sel));
    return wrap;
  }

  // ---- Review forecast: how many cards come due on each of the next 7 days ------
  function forecastPanel(cards) {
    if (!cards.length) return null;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const counts = Array(7).fill(0);
    cards.forEach(c => { const d = new Date(c.dueAt); d.setHours(0, 0, 0, 0); const i = Math.max(0, Math.round((d - start) / 86400000)); if (i < 7) counts[i]++; });
    const panel = h('section', 'nx-m3-panel nx-m3-forecast');
    panel.append(panelHead('Review forecast', 'Cards coming due over the next 7 days. Overdue cards count as today.'));
    if (!counts.some(Boolean)) { panel.append(h('p', 'nx-m3-note', 'Nothing is due in the next 7 days.')); return panel; }
    const max = Math.max(1, ...counts), chart = h('div', 'nx-m3-cols nx-m3-cols-short');
    const labels = counts.map((_, i) => (i === 0 ? 'Today' : new Date(start.getTime() + i * 86400000).toLocaleDateString('en-IN', { weekday: 'short' })));
    chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `Cards due per day: ${labels.map((l, i) => `${l} ${counts[i]}`).join(', ')}`);
    counts.forEach((n, i) => {
      const col = h('div', i === 0 ? 'nx-m3-col is-today' : 'nx-m3-col'); const bar = h('div', 'nx-m3-col-bar'); const fill = h('div', 'nx-m3-col-fill');
      fill.style.height = n ? `${Math.max(4, Math.round(n / max * 100))}%` : '3px'; bar.append(fill);
      col.append(h('span', 'nx-m3-col-val', n ? String(n) : ''), bar, h('span', 'nx-m3-col-label', labels[i])); chart.append(col);
    });
    panel.append(chart);
    return panel;
  }

  // ---- Card manager: browse, search, edit, delete, rename, export ---------------
  function exportCsv(deck) {
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = deck.cards.map(c => `${esc(c.front)},${esc(c.back)}`).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a'); a.href = url; a.download = `${deck.title.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const dueLabel = c => {
    const ms = new Date(c.dueAt).getTime() - Date.now();
    if (ms <= 0) return 'due now';
    const days = Math.ceil(ms / 86400000); return days <= 1 ? 'due tomorrow' : `due in ${days} days`;
  };

  function managePanel(decks) {
    const deck = decks.find(d => d.id === manageDeckId);
    if (!deck) { manageDeckId = ''; return null; }
    const panel = h('section', 'nx-m3-panel nx-m3-browse');
    const head = h('div', 'nx-m3-panel-head'); const box = h('div'); const tools = h('div', 'nx-m3-actions');
    const ghost = (text, fn, extra = '') => { const b = h('button', `nx-m3-btn-ghost ${extra}`, text); b.type = 'button'; b.onclick = fn; return b; };
    if (renamingDeck) {
      const inp = h('input'); inp.value = deck.title; inp.maxLength = 60;
      box.append(NexoraField('Deck name', inp));
      const save = h('button', 'nx-primary-button', 'Save name'); save.type = 'button';
      save.onclick = () => {
        const name = inp.value.trim();
        if (!name) return say('Give the deck a name.');
        if (decks.some(d => d.id !== deck.id && d.title === name)) return say('Another deck already has that name.');
        deck.title = name; saveDecks(decks); renamingDeck = false; render();
      };
      tools.append(save, ghost('Cancel', () => { renamingDeck = false; render(); }));
    } else {
      box.append(h('h2', 'nx-m3-title', `Cards · ${deck.title}`), h('p', 'nx-m3-sub', `${deck.cards.length} card${deck.cards.length === 1 ? '' : 's'}. Editing a card keeps its review history.`));
      tools.append(ghost('Rename', () => { renamingDeck = true; render(); }), ghost('Export CSV', () => exportCsv(deck)), ghost('Close', () => { manageDeckId = ''; editingCardId = ''; manageQuery = ''; render(); }));
    }
    head.append(box, tools); panel.append(head);

    if (!deck.cards.length) { panel.append(h('p', 'nx-m3-note', 'This deck has no cards yet. Add some with the form on the right.')); return panel; }
    const q = h('input'); q.type = 'search'; q.placeholder = 'Search questions and answers'; q.value = manageQuery;
    panel.append(NexoraField('Search cards', q));
    const list = h('div', 'nx-m3-scroll nx-m3-cardlist');
    const empty = h('p', 'nx-m3-note', 'No cards match your search.'); empty.hidden = true;
    deck.cards.forEach(c => {
      const row = h('div', 'nx-m3-row nx-m3-cardrow'); row.dataset.text = `${c.front} ${c.back}`.toLowerCase();
      if (editingCardId === c.id) {
        const ft = h('textarea'); ft.rows = 2; ft.value = c.front; const bt = h('textarea'); bt.rows = 3; bt.value = c.back;
        const save = h('button', 'nx-primary-button', 'Save card'); save.type = 'button';
        save.onclick = () => {
          const f = ft.value.trim(), b = bt.value.trim();
          if (!f || !b) return say('A card needs both a question and an answer.');
          if (deck.cards.some(x => x.id !== c.id && x.front === f)) return say('This deck already has a card with that question.');
          c.front = f; c.back = b; saveDecks(decks); editingCardId = ''; render();
        };
        const cancel = h('button', 'nx-secondary-button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => { editingCardId = ''; render(); };
        const edit = h('div', 'nx-m3-cardedit'); const btns = h('div', 'nx-m3-actions'); btns.append(save, cancel);
        edit.append(NexoraField('Question', ft), NexoraField('Answer', bt), btns); row.append(edit);
      } else {
        const main = h('div', 'nx-m3-row-main');
        main.append(h('strong', '', c.front), h('small', 'nx-m3-clamp', c.back), h('small', '', `${dueLabel(c)} · interval ${c.intervalDays} day${c.intervalDays === 1 ? '' : 's'}`));
        const acts = h('div', 'nx-m3-row-actions');
        const e = ghost('Edit', () => { editingCardId = c.id; render(); }); e.setAttribute('aria-label', `Edit card: ${c.front}`);
        const d = ghost('Delete', () => {
          if (!confirm('Delete this card?')) return;
          const first = queue[0]; deck.cards = deck.cards.filter(x => x.id !== c.id); saveDecks(decks);
          queue = queue.filter(id => id !== c.id); if (queue[0] !== first) revealed = false; render();
        }, 'nx-m3-btn-danger'); d.setAttribute('aria-label', `Delete card: ${c.front}`);
        acts.append(e, d); row.append(main, acts);
      }
      list.append(row);
    });
    const apply = () => { let shown = 0; list.querySelectorAll('.nx-m3-cardrow').forEach(r => { const hit = !manageQuery || r.dataset.text.includes(manageQuery); r.hidden = !hit; if (hit) shown++; }); empty.hidden = shown > 0; };
    q.oninput = () => { manageQuery = q.value.trim().toLowerCase(); apply(); };
    manageQuery = manageQuery.toLowerCase(); apply();
    panel.append(list, empty);
    return panel;
  }

  function decksPanel(decks, now) {
    const list = h('section', 'nx-m3-panel');
    list.append(panelHead('Decks', 'Pick a deck to review it on its own, or manage its cards.'));
    if (!decks.length) { list.append(h('p', 'nx-m3-note', 'No decks yet. Generate or add your first cards above.')); return list; }
    const body = h('div', 'nx-m3-scroll');
    decks.forEach(d => {
      const dueN = d.cards.filter(c => new Date(c.dueAt).getTime() <= now).length;
      const pct = d.cards.length ? Math.round(d.cards.filter(c => c.intervalDays >= 21).length / d.cards.length * 100) : 0;
      const r = h('div', d.id === activeDeck ? 'nx-m3-row nx-m3-deckrow is-active' : 'nx-m3-row nx-m3-deckrow');
      const main = h('div', 'nx-m3-row-main');
      main.append(h('strong', '', d.title), h('small', '', `${d.cards.length} card${d.cards.length === 1 ? '' : 's'} · ${pct}% mastered`));
      const badge = h('span', dueN ? 'nx-m3-badge nx-m3-badge-warn' : 'nx-m3-badge', dueN ? `${dueN} due` : 'None due');
      const acts = h('div', 'nx-m3-row-actions');
      const rev = h('button', 'nx-m3-btn-ghost', d.id === activeDeck ? 'Reviewing' : 'Review'); rev.type = 'button';
      rev.setAttribute('aria-pressed', String(d.id === activeDeck)); rev.setAttribute('aria-label', `Review deck ${d.title}`);
      rev.onclick = () => { setActiveDeck(d.id); startQueue(); render(); root.scrollIntoView?.({ block: 'start' }); };
      const cardsBtn = h('button', 'nx-m3-btn-ghost', manageDeckId === d.id ? 'Hide cards' : 'Cards'); cardsBtn.type = 'button';
      cardsBtn.setAttribute('aria-label', `${manageDeckId === d.id ? 'Hide' : 'Manage'} cards in ${d.title}`);
      cardsBtn.onclick = () => { manageDeckId = manageDeckId === d.id ? '' : d.id; editingCardId = ''; renamingDeck = false; manageQuery = ''; render(); };
      const del = h('button', 'nx-m3-btn-ghost nx-m3-btn-danger', 'Delete'); del.type = 'button';
      del.setAttribute('aria-label', `Delete deck ${d.title}`);
      del.onclick = () => {
        if (!confirm(`Delete "${d.title}" and its ${d.cards.length} cards?`)) return;
        saveDecks(loadDecks().filter(x => x.id !== d.id));
        if (activeDeck === d.id) setActiveDeck(''); if (manageDeckId === d.id) manageDeckId = '';
        startQueue(); render();
      };
      acts.append(rev, cardsBtn, del); r.append(main, badge, acts); body.append(r);
    });
    list.append(body);
    return list;
  }

  function render() {
    const decks = loadDecks();
    if (activeDeck && !decks.some(d => d.id === activeDeck)) setActiveDeck('');
    if (manageDeckId && !decks.some(d => d.id === manageDeckId)) manageDeckId = '';
    const scoped = allCards().filter(inScope);
    const now = Date.now(), dueNow = scoped.filter(isDue).length;
    const dueToday = scoped.filter(c => new Date(c.dueAt).getTime() <= endOfToday()).length;
    const scopeName = activeDeck ? decks.find(d => d.id === activeDeck)?.title : '';

    root.replaceChildren();
    const header = h('header', 'nx-m3-header');
    const title = h('h1', '', 'Recall it just before you forget it.'); title.id = 'nx-flashloop-title';
    header.append(h('p', 'nx-eyebrow', 'Study workspace / FlashLoop'), title,
      h('p', 'nx-module-description', 'Cards come back on a spaced schedule (SM-2). Rate each one honestly and FlashLoop decides when you see it next.'));

    const stats = h('section', 'nx-m3-stats nx-m3-stats-3'); stats.setAttribute('aria-label', 'Deck summary');
    stats.append(stat('Due today', dueToday, `${dueNow} ready right now`), stat('New', scoped.filter(c => c.repetitions === 0).length, 'Never reviewed'),
      stat('Total cards', scoped.length, scopeName ? `in ${scopeName}` : `${decks.length} deck${decks.length === 1 ? '' : 's'}`));

    const left = h('div', 'nx-m3-stack nx-m3-main');
    left.append(reviewPanel(scoped));
    const fc = forecastPanel(scoped); if (fc) left.append(fc);
    const mg = managePanel(decks); if (mg) left.append(mg);
    const side = h('div', 'nx-m3-stack nx-m3-side'); side.append(generatePanel(), readerPanel(), addPanel(decks), decksPanel(decks, now));
    const layout = h('div', 'nx-m3-layout'); layout.append(left, side);
    root.append(header, stats, layout, floatBtn); floatBtn.hidden = true;
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
    lastAddedDeckId = deck.id;
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
    saveDecks(found.decks); // same objects we just mutated

    const storedReviews = S.get(REVIEWS_KEY, []);
    const reviews = Array.isArray(storedReviews) ? storedReviews : [];
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
