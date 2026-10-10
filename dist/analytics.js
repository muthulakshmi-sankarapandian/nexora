/* Progress Analytics — derives everything from data other components own.
   Reads: nexora-focus-sessions, nexora-flashloop-decks, nexora-flashloop-reviews,
          nexora-quiz-attempts, nexora-study-plans.
   Writes: nothing. Listens for: nexora:focus-completed, nexora:flashcard-reviewed,
          nexora:quiz-completed, nexora:plan-updated, nexora:vault-updated.
   Views: range pills, hero metrics (study time / streak / cards due), study-time chart + study next, five-tab detailed drawer, summary stats, "study next" recommendations, weekly summary, study-time chart,
          flashcard activity + retention, quiz trend, time by subject, topic mastery,
          weak-area heatmap, needs-work / weak / strong / overdue lists. */
(() => {
  const UI_KEY = 'nexora-analytics-ui';
  const RANGES = [['today', 'Today'], ['7d', 'Past 7 days'], ['all', 'All time']];
  const TABS = [['summary', 'Summary'], ['focus', 'Focus'], ['flashcards', 'Flashcards'], ['quizzes', 'Quizzes'], ['plan', 'Plan & topics']];
  const loadUi = () => {
    let u = {}; try { u = NexoraStore.get(UI_KEY, {}) || {}; } catch (_) { /* ignore */ }
    return {
      range: RANGES.some(r => r[0] === u.range) ? u.range : '7d',
      tab: TABS.some(t => t[0] === u.tab) ? u.tab : 'summary',
      open: u.open === undefined ? true : !!u.open,
    };
  };
  const ui = loadUi();
  const saveUi = () => { try { NexoraStore.set(UI_KEY, ui); } catch (_) { /* non-critical */ } };
  const h = NexoraH, D = NexoraDate, S = NexoraStore;
  const root = h('section', 'nx-module-view nx-m3');
  root.id = 'nx-analytics';
  root.setAttribute('aria-labelledby', 'nx-analytics-title');

  const lastDays = n => Array.from({ length: n }, (_, i) => D.addDays(i - (n - 1)));
  const parseKey = k => new Date(`${k}T00:00:00`);
  const dayName = k => parseKey(k).toLocaleDateString('en-IN', { weekday: 'short' });
  const shortDate = iso => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const mondayOf = date => { const x = new Date(date); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const addDaysTo = (date, n) => { const x = new Date(date); x.setDate(x.getDate() + n); return x; };
  const RATING_Q = { again: 1, hard: 3, good: 4, easy: 5 };
  const fmtMinutes = m => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
  const pct = (a, b) => (b ? Math.round(a / b * 100) : null);

  const panelHead = (title, note) => {
    const head = h('div', 'nx-m3-panel-head'); const box = h('div');
    box.append(h('h2', 'nx-m3-title', title)); if (note) box.append(h('p', 'nx-m3-sub', note));
    head.append(box); return head;
  };
  const stat = (label, value, hint) => {
    const d = h('div', 'nx-m3-stat');
    d.append(h('span', 'nx-m3-stat-label', label), h('strong', 'nx-m3-stat-value nx-m3-gradient', value), h('span', 'nx-m3-stat-hint', hint));
    return d;
  };

  // Vertical columns. items: [{ label, value (number|null), hl }]. A fixed `max` (e.g. 100 for %) keeps scales honest.
  function columns(title, note, items, unit, opts = {}) {
    const card = h('section', 'nx-m3-panel');
    card.append(panelHead(title, note));
    if (!items.length || items.every(i => !i.value)) { card.append(h('p', 'nx-m3-note', opts.emptyText || 'Nothing recorded yet.')); return card; }
    const max = opts.max || Math.max(1, ...items.map(i => i.value || 0));
    const chart = h('div', 'nx-m3-cols');
    if (items.length !== 7) chart.style.gridTemplateColumns = `repeat(${items.length}, minmax(0, 1fr))`;
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `${title}: ${items.map(i => `${i.label} ${i.value === null ? 'no data' : `${i.value}${unit || ''}`}`).join(', ')}`);
    items.forEach(i => {
      const col = h('div', i.hl ? 'nx-m3-col is-today' : 'nx-m3-col');
      const bar = h('div', 'nx-m3-col-bar'); const fill = h('div', 'nx-m3-col-fill');
      fill.style.height = i.value ? `${Math.max(4, Math.round(i.value / max * 100))}%` : '3px'; bar.append(fill);
      col.append(h('span', 'nx-m3-col-val', i.value ? `${i.value}${unit === '%' ? '%' : ''}` : ''), bar, h('span', 'nx-m3-col-label', i.label));
      chart.append(col);
    });
    card.append(chart);
    return card;
  }

  // Horizontal bars: ranked categories with the label above and the value at the end.
  function bars(title, note, rows, unit, emptyText, max) {
    const card = h('section', 'nx-m3-panel');
    card.append(panelHead(title, note));
    if (!rows.length || rows.every(r => !r[1])) { card.append(h('p', 'nx-m3-note', emptyText || 'Nothing here yet.')); return card; }
    const top = max || Math.max(1, ...rows.map(r => r[1]));
    const wrap = h('div', 'nx-m3-bars');
    rows.forEach(([name, val]) => {
      const row = h('div', 'nx-m3-bar');
      const track = h('div', 'nx-m3-track'); const fill = h('div', 'nx-m3-fill');
      fill.style.width = `${Math.round(val / top * 100)}%`; track.append(fill);
      const label = h('span', 'nx-m3-bar-label', name); label.title = name;
      row.append(label, track, h('span', 'nx-m3-bar-val', `${val}${unit || ''}`));
      wrap.append(row);
    });
    card.append(wrap);
    return card;
  }

  // Ranked list: rows are [main, sub, badge].
  function listSection(title, note, rows, emptyText, warn) {
    const card = h('section', 'nx-m3-panel');
    card.append(panelHead(title, note));
    if (!rows.length) { card.append(h('p', 'nx-m3-note', emptyText)); return card; }
    rows.forEach(([main, sub, badge]) => {
      const r = h('div', 'nx-m3-row'); const m = h('div', 'nx-m3-row-main');
      m.append(h('strong', '', main)); if (sub) m.append(h('small', '', sub));
      r.append(m, h('span', warn ? 'nx-m3-badge nx-m3-badge-warn' : 'nx-m3-badge', badge));
      card.append(r);
    });
    return card;
  }

  // "Study next": a short, rule-based priority list (no AI, always explainable).
  function recommendationsPanel(recs) {
    const card = h('section', 'nx-m3-panel');
    card.append(panelHead('Study next', 'Ranked from your overdue work, due cards, weak topics and plan.'));
    if (!recs.length) { card.append(h('p', 'nx-m3-note', 'You are all caught up. Pick something you enjoy, or review ahead in FlashLoop.')); return card; }
    const list = h('ol', 'nx-m3-reco-list');
    recs.forEach(r => {
      const li = h('li', 'nx-m3-reco'); const main = h('div', 'nx-m3-row-main');
      main.append(h('strong', '', r.title), h('small', '', r.why));
      const a = h('a', 'nx-secondary-button', r.cta); a.href = r.href;
      li.append(main, a); list.append(li);
    });
    card.append(list);
    return card;
  }

  // Weekly summary: last 7 days vs the 7 days before, as a real table.
  function weeklyPanel(rows) {
    const card = h('section', 'nx-m3-panel');
    card.append(panelHead('Weekly summary', 'Last 7 days compared with the 7 days before.'));
    const wrap = h('div', 'nx-m3-scroll-x'); const table = h('table', 'nx-m3-table');
    const head = h('tr'); ['Measure', 'Last 7 days', 'Before', 'Change'].forEach(t => { const th = h('th', '', t); th.scope = 'col'; head.append(th); });
    const thead = h('thead'); thead.append(head);
    const tbody = h('tbody');
    rows.forEach(([name, now, before, delta]) => {
      const tr = h('tr'); const th = h('th', '', name); th.scope = 'row';
      tr.append(th, h('td', '', now), h('td', '', before), h('td', 'nx-m3-delta', delta)); tbody.append(tr);
    });
    table.append(thead, tbody); wrap.append(table); card.append(wrap);
    return card;
  }
  const change = (now, before, unit) => {
    if (now === null || before === null) return '—';
    if (unit === 'pts') { const d = now - before; return d === 0 ? 'no change' : `${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d)} pts`; }
    if (!before) return now ? 'new' : '—';
    const d = Math.round((now - before) / before * 100);
    return d === 0 ? 'no change' : `${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d)}%`;
  };

  // Weak-area heatmap: topics (quiz topics + flashcard decks) by week. Every cell prints its %, so colour is never the only signal.
  function heatmapPanel(weeks, rows) {
    const card = h('section', 'nx-m3-panel');
    card.append(panelHead('Weak-area heatmap', 'Accuracy by topic over the last 4 weeks. Weakest topics first.'));
    if (!rows.length) { card.append(h('p', 'nx-m3-note', 'Take a quiz or review flashcards to see which topics are weak.')); return card; }
    const wrap = h('div', 'nx-m3-scroll-x'); const table = h('table', 'nx-m3-heat');
    table.append(h('caption', 'nx-m3-sr', 'Accuracy percentage by topic and week'));
    const head = h('tr'); const first = h('th', '', 'Topic'); first.scope = 'col'; head.append(first);
    weeks.forEach(w => { const th = h('th', '', w); th.scope = 'col'; head.append(th); });
    const thead = h('thead'); thead.append(head); const tbody = h('tbody');
    const tone = v => (v === null ? 'heat-none' : v < 50 ? 'heat-low' : v < 75 ? 'heat-mid' : 'heat-high');
    rows.forEach(r => {
      const tr = h('tr'); const th = h('th', ''); th.scope = 'row';
      th.append(h('span', '', r.label), h('small', '', r.kind)); tr.append(th);
      r.cells.forEach(v => tr.append(h('td', tone(v), v === null ? '–' : `${v}%`)));
      tbody.append(tr);
    });
    table.append(thead, tbody); wrap.append(table);
    const legend = h('div', 'nx-m3-legend');
    [['heat-low', 'Weak: under 50%'], ['heat-mid', 'Okay: 50 to 74%'], ['heat-high', 'Strong: 75%+'], ['heat-none', 'No data']].forEach(([c, t]) => {
      const i = h('span', 'nx-m3-legend-item'); i.append(h('i', `nx-m3-swatch ${c}`), h('span', '', t)); legend.append(i);
    });
    card.append(wrap, legend);
    return card;
  }

  function render() {
    const focusSessions = S.get('nexora-focus-sessions', []);
    const decks = S.get('nexora-flashloop-decks', []);
    const reviews = S.get('nexora-flashloop-reviews', []);
    const quizAttempts = S.get('nexora-quiz-attempts', []);
    const plans = S.get('nexora-study-plans', []);
    const today = D.dayKey(), week = lastDays(7), prevWeek = lastDays(14).slice(0, 7);
    const hasAnyData = focusSessions.length || decks.length || reviews.length || quizAttempts.length || plans.length;

    root.replaceChildren();
    const header = h('header', 'nx-m3-header');
    const t = h('h1', '', 'See what is working and what is not.'); t.id = 'nx-analytics-title';
    header.append(h('p', 'nx-eyebrow', 'Focus & insights / Progress Analytics'), t,
      h('p', 'nx-module-description', 'Built from your finished focus sessions, flashcard reviews, quiz attempts, and study plans.'));
    root.append(header);

    if (!hasAnyData) {
      const empty = h('section', 'nx-m3-panel'); const body = h('div', 'nx-m3-empty');
      body.append(h('h2', 'nx-m3-title', 'No activity yet'),
        h('p', 'nx-m3-sub', 'Finish a focus session, review a flashcard, take a quiz, or check off a planned task, and your charts will appear here.'));
      const a = h('a', 'nx-secondary-button', 'Start a focus session'); a.href = '#focus'; body.append(a);
      empty.append(body); root.append(empty); return;
    }

    // ---- Focus ----
    const focusBy = k => focusSessions.filter(s => D.isoDay(s.completedAt) === k).reduce((a, s) => a + (s.completedMinutes || 0), 0);
    const focusWeek = focusSessions.filter(s => week.includes(D.isoDay(s.completedAt)));
    const distractionsWeek = focusWeek.reduce((a, s) => a + (s.distractions || 0), 0);
    const totalMinutes = focusSessions.reduce((a, s) => a + (s.completedMinutes || 0), 0);
    const weekMinutes = week.reduce((a, k) => a + focusBy(k), 0), prevMinutes = prevWeek.reduce((a, k) => a + focusBy(k), 0);

    // ---- FlashLoop ----
    const now = Date.now();
    const allCards = decks.flatMap(d => (d.cards || []).map(c => ({ ...c, deckTitle: d.title, deckId: d.id })));
    const dueNow = allCards.filter(c => new Date(c.dueAt).getTime() <= now).length;
    const mastered = allCards.filter(c => c.intervalDays >= 21).length;
    const reviewsIn = days => reviews.filter(r => days.includes(D.isoDay(r.reviewedAt)));
    const recallOf = list => (list.length ? Math.round(list.filter(r => (RATING_Q[r.rating] || 0) >= 3).length / list.length * 100) : null);
    const reviewsWeek = reviewsIn(week), reviewsPrev = reviewsIn(prevWeek);
    const recall = recallOf(reviewsWeek), recallPrev = recallOf(reviewsPrev);

    // ---- Quizzes ----
    const quizIn = days => quizAttempts.filter(a => days.includes(D.isoDay(a.completedAt)));
    const accOf = list => { const tt = list.reduce((acc, a) => { acc.score += a.score || 0; acc.total += a.total || 0; return acc; }, { score: 0, total: 0 }); return { ...tt, pct: pct(tt.score, tt.total) }; };
    const quizWeek = quizIn(week), qw = accOf(quizWeek), qp = accOf(quizIn(prevWeek));

    // ---- Planner ----
    const allTasks = plans.flatMap(p => (p.tasks || []).map(tk => ({ ...tk, plan: p })));
    const completedTasks = allTasks.filter(tk => tk.completed).length;
    const plannerRate = pct(completedTasks, allTasks.length);
    const overdue = allTasks.filter(tk => !tk.completed && tk.date && tk.date < today).sort((a, b) => a.date.localeCompare(b.date));

    // ---- Streaks: calendar days (and weeks with 3+ active days) with any dated activity ----
    const activeDays = new Set([
      ...focusSessions.map(s => D.isoDay(s.completedAt)),
      ...reviews.map(r => D.isoDay(r.reviewedAt)),
      ...quizAttempts.map(a => D.isoDay(a.completedAt)),
    ]);
    let streak = 0, cursor = activeDays.has(today) ? 0 : -1;
    while (activeDays.has(D.addDays(cursor))) { streak++; cursor--; }
    const perWeek = {};
    activeDays.forEach(k => { const w = D.dayKey(mondayOf(parseKey(k))); perWeek[w] = (perWeek[w] || 0) + 1; });
    let wCursor = mondayOf(new Date()), weeklyStreak = 0;
    if ((perWeek[D.dayKey(wCursor)] || 0) < 3) wCursor = addDaysTo(wCursor, -7); // this week is still in progress
    while ((perWeek[D.dayKey(wCursor)] || 0) >= 3) { weeklyStreak++; wCursor = addDaysTo(wCursor, -7); }
    const activeThisWeek = week.filter(k => activeDays.has(k)).length, activePrev = prevWeek.filter(k => activeDays.has(k)).length;

    // ---- Time range (drives the hero study time, chart and detailed tabs) ----
    const rangeKeys = ui.range === 'today' ? [today] : ui.range === '7d' ? week : null; // null = all time
    const prevKeys = ui.range === 'today' ? [D.addDays(-1)] : ui.range === '7d' ? prevWeek : null;
    const rangeName = ui.range === 'today' ? 'today' : ui.range === '7d' ? 'the past 7 days' : 'all time';
    const inKeys = (keys, iso) => !keys || keys.includes(D.isoDay(iso));
    const inR = iso => inKeys(rangeKeys, iso);
    const sumMinutes = list => list.reduce((acc, sx) => acc + (sx.completedMinutes || 0), 0);
    const rSessions = focusSessions.filter(sx => inR(sx.completedAt));
    const rMinutes = sumMinutes(rSessions);
    const pMinutes = prevKeys ? sumMinutes(focusSessions.filter(sx => inKeys(prevKeys, sx.completedAt))) : null;
    const rDistractions = rSessions.reduce((acc, sx) => acc + (sx.distractions || 0), 0);
    const longest = Math.max(0, ...rSessions.map(sx => sx.completedMinutes || 0));
    const plannedOf = sx => sx.plannedMinutes ?? sx.durationMinutes ?? sx.targetMinutes ?? null;
    const stoppedEarly = rSessions.filter(sx => sx.stoppedEarly || sx.status === 'stopped' || (plannedOf(sx) && (sx.completedMinutes || 0) < plannedOf(sx))).length;
    const rReviews = reviews.filter(r => inR(r.reviewedAt)), rRecall = recallOf(rReviews);
    const rQuiz = quizAttempts.filter(qa => inR(qa.completedAt)), rAcc = accOf(rQuiz);
    const bestQuiz = Math.max(0, ...rQuiz.filter(qa => qa.total).map(qa => Math.round((qa.score || 0) / qa.total * 100)));
    const rTasks = allTasks.filter(tk => !rangeKeys || rangeKeys.includes(tk.date));
    const rDone = rTasks.filter(tk => tk.completed).length;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const panels = {};

    // ---- Topic data (quiz topics + flashcard decks) used by the lists, recommendations and heatmap ----
    const topicTotals = {};
    quizAttempts.forEach(a => { if (a.topicScores && typeof a.topicScores === 'object') Object.entries(a.topicScores).forEach(([topic, v]) => {
      const tt = topicTotals[topic] || (topicTotals[topic] = { correct: 0, total: 0 });
      tt.correct += v.correct || 0; tt.total += v.total || 0;
    }); });
    const quizTopics = Object.entries(topicTotals).filter(([, v]) => v.total).map(([topic, v]) => ({ topic, pct: Math.round(v.correct / v.total * 100), total: v.total }));
    const deckRecall = decks.map(d => { const rs = reviews.filter(r => r.deckId === d.id); return { id: d.id, title: d.title, n: rs.length, pct: recallOf(rs) }; });
    const dueByDeck = decks.map(d => ({ title: d.title, n: (d.cards || []).filter(c => new Date(c.dueAt).getTime() <= now).length })).filter(x => x.n).sort((a, b) => b.n - a.n);

    // ---- Recommendations ----
    const recs = [];
    if (overdue[0]) recs.push({ score: 100 + Math.min(overdue.length, 20), title: `Catch up: ${overdue[0].title}`, why: `${overdue[0].plan.courseName || overdue[0].plan.title} · was due ${overdue[0].date}${overdue.length > 1 ? ` (+${overdue.length - 1} more overdue)` : ''}`, cta: 'Open schedule', href: '#schedule' });
    const weakest = quizTopics.filter(q => q.pct < 70 && q.total >= 3).sort((a, b) => a.pct - b.pct)[0];
    if (weakest) recs.push({ score: 100 - weakest.pct, title: `Practise ${weakest.topic}`, why: `${weakest.pct}% accuracy across ${weakest.total} quiz questions`, cta: 'Open quizzes', href: '#quiz' });
    if (dueByDeck[0]) recs.push({ score: 80 + Math.min(dueByDeck[0].n, 19), title: `Review ${dueByDeck[0].n} due card${dueByDeck[0].n === 1 ? '' : 's'} in ${dueByDeck[0].title}`, why: 'Spaced repetition works best when cards are reviewed on time', cta: 'Start review', href: '#flashloop' });
    const lowRecall = deckRecall.filter(d => d.n >= 5 && d.pct !== null && d.pct < 60).sort((a, b) => a.pct - b.pct)[0];
    if (lowRecall) recs.push({ score: 70, title: `Revisit ${lowRecall.title}`, why: `Only ${lowRecall.pct}% recalled across ${lowRecall.n} reviews`, cta: 'Open FlashLoop', href: '#flashloop' });
    const nextTask = allTasks.filter(tk => !tk.completed && tk.date && tk.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (nextTask) recs.push({ score: 60, title: `Next planned: ${nextTask.title}`, why: `${nextTask.plan.courseName || nextTask.plan.title} · ${nextTask.date === today ? 'today' : nextTask.date}`, cta: 'Start focus', href: '#focus' });
    if (!focusBy(today)) recs.push({ score: 40, title: 'Do a focus session today', why: 'No focused minutes logged yet today', cta: 'Open Focus Mode', href: '#focus' });
    recs.sort((a, b) => b.score - a.score);

    // ---- Weekly summary rows ----
    const cardsNow = reviewsWeek.length, cardsPrev = reviewsPrev.length;
    const summaryRows = [
      ['Focus time', `${weekMinutes} min`, `${prevMinutes} min`, change(weekMinutes, prevMinutes)],
      ['Cards reviewed', String(cardsNow), String(cardsPrev), change(cardsNow, cardsPrev)],
      ['Recall rate', recall === null ? '—' : `${recall}%`, recallPrev === null ? '—' : `${recallPrev}%`, change(recall, recallPrev, 'pts')],
      ['Quiz accuracy', qw.pct === null ? '—' : `${qw.pct}%`, qp.pct === null ? '—' : `${qp.pct}%`, change(qw.pct, qp.pct, 'pts')],
      ['Active days', `${activeThisWeek} of 7`, `${activePrev} of 7`, change(activeThisWeek, activePrev)],
    ];
    

    // ---- Charts ----
    const dayItems = fn => week.map(k => ({ label: k === today ? 'Today' : dayName(k), value: fn(k), hl: k === today }));
    const row1 = h('div', 'nx-m3-grid-2');
    row1.append(columns('Focus minutes', 'Last 7 days', dayItems(focusBy), ' min', { emptyText: 'Nothing recorded in the last 7 days.' }));
    row1.append(columns('Cards reviewed', 'Last 7 days', dayItems(k => reviews.filter(r => D.isoDay(r.reviewedAt) === k).length), '', { emptyText: 'Nothing recorded in the last 7 days.' }));

    const row2 = h('div', 'nx-m3-grid-2');
    row2.append(columns('Flashcard retention', 'Share of reviews not rated Again, by day', dayItems(k => recallOf(reviews.filter(r => D.isoDay(r.reviewedAt) === k))), '%', { max: 100, emptyText: 'Review some flashcards to see retention.' }));
    const lastQuizzes = quizAttempts.filter(a => a.total).slice().sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt))).slice(-8);
    row2.append(columns('Quiz performance', `Score on your last ${lastQuizzes.length || 'few'} quizzes`, lastQuizzes.map((a, i) => ({ label: shortDate(a.completedAt), value: Math.round((a.score || 0) / a.total * 100), hl: i === lastQuizzes.length - 1 })), '%', { max: 100, emptyText: 'No quiz attempts yet.' }));

    const row3 = h('div', 'nx-m3-grid-2');
    const bySubject = {}; focusSessions.filter(s => inR(s.completedAt)).forEach(s => { const name = s.title || 'Untitled'; bySubject[name] = (bySubject[name] || 0) + (s.completedMinutes || 0); });
    row3.append(bars('Time by subject', `Focus minutes by subject, ${rangeName}`, Object.entries(bySubject).sort((a, b) => b[1] - a[1]).slice(0, 6), ' min', 'Finish a focus session to see time by subject.'));
    const mastery = decks.map(d => [d.title, d.cards.length ? Math.round(d.cards.filter(c => c.intervalDays >= 21).length / d.cards.length * 100) : 0]).sort((a, b) => a[1] - b[1]).slice(0, 6);
    row3.append(bars('Topic mastery', 'Share of each deck retained for 21+ days', mastery, '%', 'Cards reach mastery after they stay remembered for 21+ days.', 100));

    // ---- Weak-area heatmap (4 calendar weeks, Monday start) ----
    const thisMonday = mondayOf(new Date());
    const wins = [3, 2, 1, 0].map(i => { const start = addDaysTo(thisMonday, -7 * i); return { from: D.dayKey(start), to: D.dayKey(addDaysTo(start, 6)) }; });
    const weekLabels = ['3 weeks ago', '2 weeks ago', 'Last week', 'This week'];
    const inWin = (iso, w) => { const k = D.isoDay(iso); return k >= w.from && k <= w.to; };
    const heatRows = [];
    Object.keys(topicTotals).forEach(topic => {
      const cells = wins.map(w => { let c = 0, n = 0; quizAttempts.filter(a => inWin(a.completedAt, w)).forEach(a => { const v = a.topicScores?.[topic]; if (v) { c += v.correct || 0; n += v.total || 0; } }); return pct(c, n); });
      if (cells.some(v => v !== null)) heatRows.push({ label: topic, kind: 'Quiz topic', cells, overall: pct(topicTotals[topic].correct, topicTotals[topic].total) });
    });
    decks.forEach(d => {
      const mine = reviews.filter(r => r.deckId === d.id);
      const cells = wins.map(w => recallOf(mine.filter(r => inWin(r.reviewedAt, w))));
      if (cells.some(v => v !== null)) heatRows.push({ label: d.title, kind: 'Flashcard deck', cells, overall: recallOf(mine) });
    });
    heatRows.sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101));
    const heatPanel = heatmapPanel(weekLabels, heatRows.slice(0, 8));

    // ---- Needs-work lists ----
    const lapseCounts = {};
    reviews.forEach(r => { if (r.rating === 'again') lapseCounts[r.cardId] = (lapseCounts[r.cardId] || 0) + 1; });
    const cardById = {}; allCards.forEach(c => { cardById[c.id] = c; });
    const weakCards = Object.entries(lapseCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, n]) => cardById[id] ? [cardById[id].front, cardById[id].deckTitle, `missed ${n}×`] : null).filter(Boolean);
    const weakTopics = quizTopics.filter(q => q.pct < 75).sort((a, b) => a.pct - b.pct).slice(0, 5).map(q => [q.topic, 'Quiz accuracy', `${q.pct}%`]);
    const strong = [
      ...quizTopics.filter(q => q.pct >= 80 && q.total >= 3).map(q => ({ name: q.topic, sub: 'Quiz topic', pct: q.pct })),
      ...deckRecall.filter(d => d.n >= 5 && d.pct !== null && d.pct >= 85).map(d => ({ name: d.title, sub: 'Flashcard deck', pct: d.pct })),
    ].sort((a, b) => b.pct - a.pct).slice(0, 5).map(x => [x.name, x.sub, `${x.pct}%`]);
    const overdueRows = overdue.slice(0, 8).map(tk => [tk.title, tk.plan.courseName || tk.plan.title, `due ${tk.date}`]);

    const lists = h('div', 'nx-m3-grid-2');
    lists.append(
      listSection('Needs work', 'Flashcards you rate "Again" most often.', weakCards, 'No weak cards yet.', true),
      listSection('Weak quiz topics', 'Quiz topics under 75% accuracy.', weakTopics, quizTopics.length ? 'No weak topics right now. Nice work.' : 'No quiz attempts yet.', true),
      listSection('Strong topics', 'Quiz topics at 80%+ and decks recalled 85%+ (enough data only).', strong, 'Strong topics appear once you have a few quiz answers or reviews.', false),
      listSection('Overdue tasks', 'From your study plans.', overdueRows, plans.length ? 'Nothing overdue.' : 'No study plans yet.', true));

    // ================= Build the page =================
    const [, cardsChart] = [...row1.children], [retentionChart, quizChart] = [...row2.children], [subjectBars, masteryBars] = [...row3.children];
    const [weakCardsList, weakTopicsList, strongList, overdueList] = [...lists.children];

    // Range pills + one-line explanation
    const toolbar = h('div', 'nx-m3-toolbar');
    toolbar.append(h('p', 'nx-m3-toolbar-note', `Showing ${rangeName}. Streaks and cards due always show right now.`));
    const seg = h('div', 'nx-m3-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Time range');
    RANGES.forEach(([key, label]) => {
      const btn = h('button', ui.range === key ? 'nx-m3-seg-btn is-active' : 'nx-m3-seg-btn', label); btn.type = 'button';
      btn.dataset.range = key; btn.setAttribute('aria-pressed', String(ui.range === key));
      btn.onclick = () => { if (ui.range === key) return; ui.range = key; saveUi(); render(); root.querySelector(`[data-range="${key}"]`)?.focus(); };
      seg.append(btn);
    });
    toolbar.append(seg);

    // Hero: the three numbers that matter most
    const heroCard = (label, value, lines, link, primary) => {
      const c = h('div', primary ? 'nx-m3-stat nx-m3-hero-card is-primary' : 'nx-m3-stat nx-m3-hero-card');
      c.append(h('span', 'nx-m3-stat-label', label), h('strong', 'nx-m3-stat-value nx-m3-gradient', value));
      lines.filter(Boolean).forEach(t => c.append(h('span', 'nx-m3-stat-hint', t)));
      if (link) { const a = h('a', 'nx-m3-hero-link', link[0]); a.href = link[1]; c.append(a); }
      return c;
    };
    const vs = prevKeys && (rMinutes || pMinutes) ? `${change(rMinutes, pMinutes)} vs ${ui.range === 'today' ? 'yesterday' : 'the 7 days before'}` : '';
    const hero = h('section', 'nx-m3-hero'); hero.setAttribute('aria-label', 'Key numbers');
    hero.append(
      heroCard(`Study time · ${ui.range === 'today' ? 'today' : ui.range === '7d' ? 'past 7 days' : 'all time'}`, fmtMinutes(rMinutes), [plural(rSessions.length, 'focus session', 'focus sessions'), vs], ['Open Focus Mode →', '#focus'], true),
      heroCard('Active streak', `${streak} day${streak === 1 ? '' : 's'}`, [activeDays.has(today) ? 'You studied today ✓' : streak ? 'Study today to keep it going' : 'Do anything today to start one', weeklyStreak ? `Weekly streak: ${plural(weeklyStreak, 'week', 'weeks')}` : ''], null),
      heroCard('Cards due', String(dueNow), [dueNow ? 'Ready to review now' : 'Nothing waiting'], dueNow ? ['Start review →', '#flashloop'] : null));

    // Study time chart (follows the range) beside Study next
    const dayHrs = ['12a', '4a', '8a', '12p', '4p', '8p'];
    let timeChart;
    if (ui.range === 'today') {
      const blocks = dayHrs.map(() => 0);
      rSessions.forEach(sx => { const hr = new Date(sx.completedAt).getHours(); if (!Number.isNaN(hr)) blocks[Math.min(5, Math.floor(hr / 4))] += sx.completedMinutes || 0; });
      const cur = Math.floor(new Date().getHours() / 4);
      timeChart = columns('Study time · today', 'Each bar is a 4-hour block (12a = midnight to 4am).', blocks.map((v, i) => ({ label: dayHrs[i], value: v, hl: i === cur })), ' min', { emptyText: 'No focus time recorded today yet.' });
    } else if (ui.range === '7d') {
      timeChart = columns('Study time · past 7 days', 'Last 7 days', dayItems(focusBy), ' min', { emptyText: 'Nothing recorded in the last 7 days.' });
    } else {
      const weeks8 = Array.from({ length: 8 }, (_, i) => addDaysTo(mondayOf(new Date()), -7 * (7 - i)));
      timeChart = columns('Study time · all time', 'Weekly totals for the last 8 weeks', weeks8.map((start, i) => {
        const keys = Array.from({ length: 7 }, (_, d) => D.dayKey(addDaysTo(start, d)));
        return { label: shortDate(start), value: keys.reduce((acc, k) => acc + focusBy(k), 0), hl: i === 7 };
      }), ' min', { emptyText: 'No focus time recorded yet.' });
    }
    const mid = h('div', 'nx-m3-grid-2'); mid.append(timeChart, recommendationsPanel(recs.slice(0, 3)));

    // Detailed analytics: collapsible, five tabs
    const statRow = items => { const g = h('div', 'nx-m3-stats'); items.forEach(([k, v, hint]) => g.append(stat(k, v, hint))); return g; };
    const pair = (...els) => { const g = h('div', 'nx-m3-grid-2'); g.append(...els); return g; };
    const stack = (...els) => { const g = h('div', 'nx-m3-stack'); g.append(...els); return g; };
    panels.summary = stack(statRow([
      ['Recall rate', rRecall === null ? '—' : `${rRecall}%`, rReviews.length ? `${plural(rReviews.length, 'review', 'reviews')}, not rated Again` : `No reviews ${rangeName}`],
      ['Quiz accuracy', rAcc.pct === null ? '—' : `${rAcc.pct}%`, rAcc.total ? `${rAcc.score} of ${rAcc.total} correct` : `No quizzes ${rangeName}`],
      ['Planner', rTasks.length ? `${pct(rDone, rTasks.length)}%` : '—', rTasks.length ? `${rDone} of ${rTasks.length} tasks done` : 'No planned tasks'],
      ['Cards mastered', String(mastered), `of ${allCards.length} (retained 21+ days)`],
    ]), weeklyPanel(summaryRows));
    panels.focus = stack(statRow([
      ['Distractions', String(rDistractions), `tab switches, ${rangeName.replace(/^the /, '')}`],
      ['Per session', rSessions.length ? (rDistractions / rSessions.length).toFixed(1) : '—', 'average distractions'],
      ['Longest session', longest ? fmtMinutes(longest) : '—', rangeName.replace(/^the /, '')],
      ['Stopped early', String(stoppedEarly), 'sessions ended before the timer'],
    ]), subjectBars);
    panels.flashcards = stack(statRow([
      ['Reviews', String(rReviews.length), rangeName.replace(/^the /, '')],
      ['Recall rate', rRecall === null ? '—' : `${rRecall}%`, 'not rated Again'],
      ['Cards mastered', String(mastered), 'retained 21+ days'],
      ['Due now', String(dueNow), `of ${allCards.length} cards`],
    ]), pair(cardsChart, retentionChart), masteryBars);
    panels.quizzes = stack(statRow([
      ['Quizzes taken', String(rQuiz.length), rangeName.replace(/^the /, '')],
      ['Accuracy', rAcc.pct === null ? '—' : `${rAcc.pct}%`, rAcc.total ? `${rAcc.score} of ${rAcc.total} correct` : 'No answers yet'],
      ['Questions', String(rAcc.total), 'answered'],
      ['Best score', rQuiz.length ? `${bestQuiz}%` : '—', 'single quiz'],
    ]), pair(quizChart, weakTopicsList));
    panels.plan = stack(statRow([
      ['Planner', rTasks.length ? `${pct(rDone, rTasks.length)}%` : '—', 'tasks completed'],
      ['Tasks done', `${rDone}/${rTasks.length}`, rangeName.replace(/^the /, '')],
      ['Overdue', String(overdue.length), 'open tasks past their date'],
      ['Weekly streak', `${weeklyStreak} wk${weeklyStreak === 1 ? '' : 's'}`, 'weeks with 3+ active days'],
    ]), heatPanel, pair(weakCardsList, strongList), overdueList);

    const drawer = h('details', 'nx-m3-panel nx-m3-drawer'); drawer.open = ui.open;
    const sum = h('summary', 'nx-m3-drawer-summary'); const sumText = h('span', 'nx-m3-drawer-text');
    sumText.append(h('strong', 'nx-m3-title', 'Detailed analytics'), h('small', 'nx-m3-sub', `Focus, flashcards, quizzes and topics for ${rangeName}`));
    const chev = h('span', 'nx-m3-drawer-chevron'); chev.setAttribute('aria-hidden', 'true'); sum.append(sumText, chev); drawer.append(sum);
    drawer.addEventListener('toggle', () => { ui.open = drawer.open; saveUi(); });
    const tabs = h('div', 'nx-m3-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Analytics sections');
    const tabBtns = TABS.map(([key, label]) => {
      const tb = h('button', 'nx-m3-tab', label); tb.type = 'button'; tb.id = `nx-an-tab-${key}`;
      tb.setAttribute('role', 'tab'); tb.setAttribute('aria-controls', `nx-an-panel-${key}`); return tb;
    });
    const showTab = (key, focus) => {
      ui.tab = key; saveUi();
      TABS.forEach(([k], i) => {
        const on = k === key; tabBtns[i].classList.toggle('is-active', on);
        tabBtns[i].setAttribute('aria-selected', String(on)); tabBtns[i].tabIndex = on ? 0 : -1; panels[k].hidden = !on;
        if (on && focus) tabBtns[i].focus();
      });
    };
    tabBtns.forEach((tb, i) => {
      tb.onclick = () => showTab(TABS[i][0]);
      tb.onkeydown = e => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!step) return;
        e.preventDefault(); showTab(TABS[(i + step + TABS.length) % TABS.length][0], true);
      };
      tabs.append(tb);
    });
    TABS.forEach(([k]) => { panels[k].id = `nx-an-panel-${k}`; panels[k].setAttribute('role', 'tabpanel'); panels[k].setAttribute('aria-labelledby', `nx-an-tab-${k}`); });
    const body = h('div', 'nx-m3-drawer-body'); body.append(tabs, ...TABS.map(([k]) => panels[k])); drawer.append(body);
    showTab(ui.tab);

    root.append(toolbar, hero, mid, drawer);
  }

  ['nexora:focus-completed', 'nexora:flashcard-reviewed', 'nexora:quiz-completed', 'nexora:plan-updated', 'nexora:vault-updated']
    .forEach(evt => window.addEventListener(evt, () => { if (!root.hidden) render(); }));
  NexoraRegisterPage('analytics', root, render);
})();
