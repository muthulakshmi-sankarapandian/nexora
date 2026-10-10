/* Focus Mode — one timer, shared by this page and the Overview card.
   Storage: nexora-focus-settings (durations/goal), nexora-focus-sessions (history),
            nexora-focus-active (in-progress session, so a refresh can resume it).
   Event out: nexora:focus-completed { ...session }
   Event out (when a linked planner task finishes): nexora:plan-updated { planId } */
(() => {
  const h = NexoraH, D = NexoraDate, S = NexoraStore, say = NexoraSay;
  const SETTINGS_KEY = 'nexora-focus-settings';
  const SESSIONS_KEY = 'nexora-focus-sessions';
  const ACTIVE_KEY = 'nexora-focus-active';

  let cfg = { focus: 25, short: 5, long: 15, goal: 4, notify: false, sound: true, autoBreak: false };
  Object.assign(cfg, S.get(SETTINGS_KEY, {}));
  const saveCfg = () => S.set(SETTINGS_KEY, cfg);

  const PRESETS = [
    { name: 'Standard', focus: 25, short: 5, long: 15 },
    { name: 'Deep Work', focus: 50, short: 10, long: 20 },
    { name: 'Short Reset', focus: 15, short: 3, long: 12 },
  ];
  const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
  const modeSeconds = m => cfg[m] * 60;
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  let mode = 'focus', remaining = modeSeconds('focus'), endsAt = 0, timer = null, cycle = 0;
  let linkedType = '', linkedId = '', customLabel = '';
  let sessionId = null, sessionStartedAt = null, distractions = 0, bannerTimer = null;
  const fresh = () => !timer && remaining === modeSeconds(mode) && !sessionId;

  // ---- Linkable items: planner tasks (Aishwarya), quizzes (Aishwarya), FlashLoop decks (mine), custom ----
  function planOptions() {
    const raw = S.get('nexora-study-plans', []), plans = Array.isArray(raw) ? raw : [];   // tolerate malformed data from other components
    const opts = [];
    plans.forEach(p => { if (!p || typeof p !== 'object') return; (Array.isArray(p.tasks) ? p.tasks : []).forEach(t => { if (t && !t.completed) opts.push({ value: `plan:${p.id}:${t.id}`, label: `${t.title} — ${p.courseName || p.title}` }); }); });
    return opts;
  }
  function overviewFallbackOptions() {
    // Used only until the planner (#schedule) exists, so Focus Mode still has something to link to.
    const rawPlans = S.get('nexora-study-plans', []); if (Array.isArray(rawPlans) && rawPlans.length) return [];
    let saved = []; try { saved = JSON.parse(localStorage.getItem('nexora-sample-tasks') || '[]'); } catch (_) {}
    return [...document.querySelectorAll('.nx-plan-row')]
      .map((row, i) => ({ i, label: row.querySelector('.nx-plan-copy strong')?.textContent, completed: Boolean(saved[i]) }))
      .filter(t => t.label && !t.completed)
      .map(t => ({ value: `overview:${t.i}`, label: t.label }));
  }
  const listOf = key => { const v = S.get(key, []); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []; };   // malformed data reads as empty
  function quizOptions() { return listOf('nexora-quizzes').map(q => ({ value: `quiz:${q.id}`, label: q.title || 'Quiz' })); }
  function deckOptions() {
    const now = Date.now();
    return listOf('nexora-flashloop-decks').map(d => {
      const due = (Array.isArray(d.cards) ? d.cards : []).filter(c => c && new Date(c.dueAt).getTime() <= now).length;
      return { value: `deck:${d.id}`, label: due ? `${d.title} (${due} due)` : d.title };
    });
  }
  function optionLabel(value) {
    if (!value || value === 'custom') return null;
    const all = [...planOptions(), ...overviewFallbackOptions(), ...quizOptions(), ...deckOptions()];
    return all.find(o => o.value === value)?.label || null;
  }
  function currentTaskLabel() {
    if (!linkedType) return '';
    if (linkedType === 'custom') return customLabel;
    return optionLabel(`${linkedType}:${linkedId}`) || customLabel || '';
  }
  function setLinked(value) {
    if (!value) { linkedType = ''; linkedId = ''; return; }
    if (value === 'custom') { linkedType = 'custom'; linkedId = ''; return; }
    const [type, ...rest] = value.split(':');
    linkedType = type; linkedId = rest.join(':');
  }
  function planTask(planId, taskId) {
    const raw = S.get('nexora-study-plans', []), plans = Array.isArray(raw) ? raw : [];
    const plan = plans.find(p => p && typeof p === 'object' && p.id === planId);
    return { plans, plan, task: Array.isArray(plan?.tasks) ? plan.tasks.find(t => t && t.id === taskId) : undefined };
  }
  function completeTask(type, id) {
    if (type === 'plan') {
      const [planId, taskId] = String(id).split(':');
      const { plans, plan, task } = planTask(planId, taskId);
      if (!task) return;
      task.completed = true; plan.updatedAt = D.isoNow();
      S.set('nexora-study-plans', plans);
      window.dispatchEvent(new CustomEvent('nexora:plan-updated', { detail: { planId } }));
    } else if (type === 'overview') {
      const cb = document.querySelectorAll('.nx-plan-row input[type="checkbox"]')[Number(id)];
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }
  const completeLinkedTask = () => completeTask(linkedType, linkedId);
  const minutesLogged = (type, id) => listOf(SESSIONS_KEY).filter(x => x.linkedType === type && x.linkedId === id).reduce((a, x) => a + (x.completedMinutes || 0), 0);
  function plannedMinutes(type, id) {
    if (type !== 'plan') return null;
    const [planId, taskId] = String(id).split(':');
    return planTask(planId, taskId).task?.durationMinutes || null;
  }

  // ---- Distraction tracking (Page Visibility API) -------------------------
  document.addEventListener('visibilitychange', () => {
    if (mode !== 'focus' || !timer) return;
    if (document.hidden) { distractions++; }
    else { banner.hidden = false; clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { banner.hidden = true; }, 4000); }
    draw();
  });

  // ---- Notifications (only after the user opts in and the browser grants permission) ----
  function notifyIfAllowed(text) {
    if (!cfg.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
    try { new Notification('Nexora — Focus Mode', { body: text }); } catch (_) {}
  }

  // A short two-note chime; only runs after the user has interacted with the page (they pressed Start).
  function chime() {
    if (!cfg.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(), t0 = ctx.currentTime;
      [660, 880].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.22;
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.5);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch (_) { /* sound is optional */ }
  }

  // ---- Layout ---------------------------------------------------------------
  const root = h('section', 'nx-module-view nx-m3');
  root.id = 'nx-focus';
  root.setAttribute('aria-labelledby', 'nx-focus-page-title');

  // Progress ring (SVG). Colours come from tokens via CSS / style.stopColor.
  const NS = 'http://www.w3.org/2000/svg', RING_R = 88, RING_C = 2 * Math.PI * RING_R;
  const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const ring = svgEl('svg', { viewBox: '0 0 200 200', 'aria-hidden': 'true', focusable: 'false' });
  const grad = svgEl('linearGradient', { id: 'nx-m3-ring-grad', x1: '0', y1: '0', x2: '1', y2: '1' });
  [['0', 'var(--nx-accent)'], ['1', 'var(--nx-secondary)']].forEach(([o, c]) => { const st = svgEl('stop', { offset: o }); st.style.stopColor = c; grad.append(st); });
  const defs = svgEl('defs'); defs.append(grad);
  const ringBar = svgEl('circle', { class: 'nx-m3-ring-bar', cx: 100, cy: 100, r: RING_R });
  ringBar.style.strokeDasharray = String(RING_C);
  ring.append(defs, svgEl('circle', { class: 'nx-m3-ring-track', cx: 100, cy: 100, r: RING_R }), ringBar);

  const presetRow = h('div', 'nx-m3-chips'); presetRow.setAttribute('role', 'group'); presetRow.setAttribute('aria-label', 'Session length presets');
  const modeRow = h('div', 'nx-m3-seg'); modeRow.setAttribute('role', 'group'); modeRow.setAttribute('aria-label', 'Timer mode');
  const taskSelect = h('select');
  const customInput = h('input'); customInput.maxLength = 80; customInput.placeholder = 'e.g. Chapter 4 problem set';
  const taskField = NexoraField('Linked task', taskSelect);
  const customField = NexoraField('What are you working on?', customInput); customField.hidden = true;
  const linkedLabel = h('p', 'nx-m3-linked-task'); linkedLabel.hidden = true;
  const clock = h('output', 'nx-m3-clock nx-m3-gradient', fmt(remaining)); clock.setAttribute('aria-live', 'off');
  const modeLabel = h('span', 'nx-m3-clock-mode', MODES[mode]);
  const cycleHint = h('span', 'nx-m3-cycle', '');
  const ringWrap = h('div', 'nx-m3-ring'); const ringCenter = h('div', 'nx-m3-ring-center');
  ringCenter.append(modeLabel, clock, cycleHint); ringWrap.append(ring, ringCenter);
  const distractionChip = h('p', 'nx-m3-distraction'); distractionChip.hidden = true;
  const banner = h('p', 'nx-m3-banner', 'Get back in the zone — your focus session is still running.'); banner.hidden = true; banner.setAttribute('role', 'status');
  const startBtn = h('button', 'nx-primary-button nx-m3-btn-lg', 'Start'); startBtn.type = 'button';
  const resetBtn = h('button', 'nx-secondary-button', 'Reset'); resetBtn.type = 'button';
  const skipBtn = h('button', 'nx-secondary-button', 'Skip'); skipBtn.type = 'button';
  const stopBtn = h('button', 'nx-secondary-button', 'Stop & save'); stopBtn.type = 'button'; stopBtn.hidden = true;
  stopBtn.title = 'End this session now and keep the minutes you focused';
  const fsBtn = h('button', 'nx-m3-btn-ghost', 'Full screen'); fsBtn.type = 'button'; fsBtn.setAttribute('aria-pressed', 'false');
  const taskPrompt = h('div', 'nx-m3-banner'); taskPrompt.hidden = true; taskPrompt.setAttribute('role', 'group'); taskPrompt.setAttribute('aria-label', 'Task check');
  const taskHint = h('p', 'nx-m3-sub', ''); taskHint.hidden = true;
  const goalBox = h('section', 'nx-m3-panel'); const todayList = h('section', 'nx-m3-panel');
  const advanced = h('details', 'nx-m3-panel nx-m3-details');

  const header = h('header', 'nx-m3-header');
  const t = h('h1', '', 'A clear stretch of time.'); t.id = 'nx-focus-page-title';
  header.append(h('p', 'nx-eyebrow', 'Focus & insights / Focus Mode'), t,
    h('p', 'nx-module-description', 'Pick a task, choose a length, and go. Leaving the tab counts as a distraction; finishing (or confirming an early stop) logs the session.'));

  const modeButtons = {};
  Object.entries(MODES).forEach(([m, name]) => {
    const b = h('button', '', name); b.type = 'button';
    b.onclick = () => { if (!fresh() && !confirm('Switch mode and stop the current session?')) return; if (!fresh()) stopEarly(); switchMode(m); };
    modeButtons[m] = b; modeRow.append(b);
  });

  const actions = h('div', 'nx-m3-actions nx-m3-actions-center'); actions.append(startBtn, stopBtn, resetBtn, skipBtn);
  const timerPanel = h('section', 'nx-m3-panel nx-m3-timer'); timerPanel.setAttribute('aria-label', 'Focus timer');
  const tools = h('div', 'nx-m3-timer-tools'); tools.append(presetRow, fsBtn);
  timerPanel.append(tools, modeRow, ringWrap, banner, taskPrompt, linkedLabel, distractionChip, taskField, taskHint, customField, actions);
  const side = h('div', 'nx-m3-stack nx-m3-side'); side.append(goalBox, todayList, advanced);
  const layout = h('div', 'nx-m3-layout'); layout.append(timerPanel, side);
  root.append(header, layout);

  // ---- Rendering ----------------------------------------------------------
  function buildPresets() {
    presetRow.replaceChildren();
    PRESETS.forEach(p => {
      const active = p.focus === cfg.focus && p.short === cfg.short && p.long === cfg.long;
      const b = h('button', 'nx-m3-chip', `${p.name} · ${p.focus}/${p.short}`);
      b.type = 'button'; b.setAttribute('aria-pressed', String(active));
      b.onclick = () => {
        if (!fresh() && !confirm('Switching presets will stop the current session. Save progress so far?')) return;
        if (!fresh()) stopEarly();
        cfg.focus = p.focus; cfg.short = p.short; cfg.long = p.long; saveCfg();
        remaining = modeSeconds(mode); draw(); buildPresets();
      };
      presetRow.append(b);
    });
  }
  function buildTaskSelect() {
    const keep = taskSelect.value;
    taskSelect.replaceChildren();
    taskSelect.append(Object.assign(h('option', '', 'No linked task'), { value: '' }));
    const groups = [["Today's plan", planOptions().length ? planOptions() : overviewFallbackOptions()], ['Quizzes', quizOptions()], ['FlashLoop decks', deckOptions()]];
    groups.forEach(([label, opts]) => {
      if (!opts.length) return;
      const g = h('optgroup'); g.label = label;
      opts.forEach(o => g.append(Object.assign(h('option', '', o.label), { value: o.value })));
      taskSelect.append(g);
    });
    taskSelect.append(Object.assign(h('option', '', 'Type your own…'), { value: 'custom' }));
    const has = v => [...taskSelect.options].some(o => o.value === v);
    // If the linked planner task was just completed, move on to the next scheduled one.
    const nextPlan = keep.startsWith('plan:') ? planOptions()[0]?.value : '';
    taskSelect.value = has(keep) ? keep : (nextPlan && has(nextPlan) ? nextPlan : '');
    setLinked(taskSelect.value);
    customField.hidden = linkedType !== 'custom';
  }
  // After a refresh-resume, show the restored link in the dropdown instead of "No linked task".
  function syncTaskSelect() {
    const v = linkedType === 'custom' ? 'custom' : linkedType ? `${linkedType}:${linkedId}` : '';
    if (![...taskSelect.options].some(o => o.value === v)) {
      if (linkedType && linkedType !== 'custom') taskSelect.append(Object.assign(h('option', '', customLabel || 'Linked task'), { value: v }));
    }
    taskSelect.value = [...taskSelect.options].some(o => o.value === v) ? v : '';
    customInput.value = customLabel || '';
    customField.hidden = linkedType !== 'custom';
  }
  function draw() {
    const text = fmt(remaining);
    clock.textContent = text;
    const frac = Math.max(0, Math.min(1, remaining / modeSeconds(mode)));
    ringBar.style.strokeDashoffset = String(RING_C * (1 - frac));
    ringWrap.classList.toggle('is-break', mode !== 'focus');
    modeLabel.textContent = !timer && !fresh() ? `${MODES[mode]} · paused` : MODES[mode];
    // Overview card shares this timer
    const oc = document.getElementById('nx-clock'); if (oc) oc.textContent = text;
    const ol = document.querySelector('.nx-focus-linked strong');
    if (ol) ol.textContent = currentTaskLabel() || 'No task linked. Choose one in Focus Mode';
    const os = document.querySelector('#nx-focus-start span');
    if (os) os.textContent = timer ? 'View session' : fresh() ? 'Start session' : 'Resume session';
    const orr = document.getElementById('nx-focus-reset'); if (orr) orr.hidden = fresh();

    startBtn.textContent = timer ? 'Pause' : fresh() ? 'Start' : 'Resume';
    resetBtn.hidden = fresh();
    stopBtn.hidden = !(mode === 'focus' && sessionId);
    cycleHint.textContent = mode === 'focus' ? `Session ${(cycle % 4) + 1} of 4` : mode === 'long' ? 'Cycle complete' : `Next: session ${(cycle % 4) + 1} of 4`;
    const logged = linkedType && linkedType !== 'custom' ? minutesLogged(linkedType, linkedId) : 0, planned = plannedMinutes(linkedType, linkedId);
    taskHint.hidden = !(logged || planned);
    taskHint.textContent = planned ? `${logged} of ${planned} min logged on this task.` : `${logged} min logged on this task.`;
    Object.entries(modeButtons).forEach(([m, b]) => b.setAttribute('aria-pressed', String(m === mode)));
    const label = currentTaskLabel();
    linkedLabel.hidden = !(timer && mode === 'focus' && label);
    linkedLabel.textContent = label ? `Working on: ${label}` : '';
    distractionChip.hidden = !(timer && mode === 'focus' && distractions > 0);
    distractionChip.textContent = `Distractions this session: ${distractions}`;
  }
  function drawSummary() {
    const sessions = listOf(SESSIONS_KEY);
    const today = sessions.filter(s => D.isoDay(s.completedAt) === D.dayKey());
    const mins = today.reduce((a, s) => a + (s.completedMinutes || 0), 0);

    goalBox.replaceChildren();
    const goalHead = h('div', 'nx-m3-panel-head'); goalHead.append(h('h2', 'nx-m3-title', 'Daily goal'));
    const big = h('p', 'nx-m3-goal');
    big.append(h('strong', 'nx-m3-gradient', String(today.length)), h('span', '', `of ${cfg.goal} sessions · ${mins} min focused`));
    goalBox.append(goalHead, big, NexoraProgress(Math.min(1, today.length / cfg.goal), `${today.length} of ${cfg.goal} sessions today`));

    todayList.replaceChildren();
    const listHead = h('div', 'nx-m3-panel-head'); const lb = h('div');
    lb.append(h('h2', 'nx-m3-title', 'Sessions today'), h('p', 'nx-m3-sub', 'Finished or stopped sessions appear here.')); listHead.append(lb);
    todayList.append(listHead);
    if (!today.length) todayList.append(h('p', 'nx-m3-note', 'No sessions yet. Start the timer to log your first one.'));
    else {
      const body = h('div', 'nx-m3-scroll');
      today.slice().reverse().forEach(s => {
        const r = h('div', 'nx-m3-row'); const main = h('div', 'nx-m3-row-main');
        const time = new Date(s.completedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const extra = [time, s.status === 'stopped' ? 'stopped early' : null, s.distractions ? `${s.distractions} distraction${s.distractions === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
        main.append(h('strong', '', s.title || 'Untitled session'), h('small', '', extra));
        r.append(main, h('span', 'nx-m3-row-val', `${s.completedMinutes} min`)); body.append(r);
      });
      todayList.append(body);
    }

    advanced.replaceChildren();
    advanced.append(h('summary', '', 'Timer settings'));
    const body = h('div', 'nx-m3-fold-body'); const grid = h('div', 'nx-m3-fields');
    [['focus', 'Focus (min)'], ['short', 'Short break (min)'], ['long', 'Long break (min)'], ['goal', 'Daily goal (sessions)']].forEach(([k, name]) => {
      const i = h('input'); i.type = 'number'; i.min = 1; i.max = 180; i.value = cfg[k]; i.inputMode = 'numeric';
      i.onchange = () => { cfg[k] = Math.max(1, Math.min(180, Number(i.value) || cfg[k])); i.value = cfg[k]; saveCfg(); if (fresh() && k === mode) remaining = modeSeconds(mode); draw(); buildPresets(); drawSummary(); advanced.open = true; };
      grid.append(NexoraField(name, i));
    });
    const notifyLabel = h('label', 'nx-m3-check');
    const notifyBox = h('input'); notifyBox.type = 'checkbox'; notifyBox.checked = cfg.notify;
    notifyBox.onchange = async () => {
      if (notifyBox.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { notifyBox.checked = false; say('Notifications were not allowed by the browser.'); }
      }
      cfg.notify = notifyBox.checked; saveCfg();
    };
    notifyLabel.append(notifyBox, h('span', '', 'Notify me when a session ends (only while this tab is hidden)'));
    const mkCheck = (key, text) => {
      const lab = h('label', 'nx-m3-check'), box = h('input'); box.type = 'checkbox'; box.checked = Boolean(cfg[key]);
      box.onchange = () => { cfg[key] = box.checked; saveCfg(); };
      lab.append(box, h('span', '', text)); return lab;
    };
    body.append(grid, notifyLabel, mkCheck('sound', 'Play a chime when a session or break ends'), mkCheck('autoBreak', 'Start breaks automatically after a focus session'));
    advanced.append(body);
  }

  // ---- Persisting the active session, so a refresh can resume it ----------
  function persistActive() {
    S.set(ACTIVE_KEY, { sessionId, mode, cycle, endsAt, linkedType, linkedId, customLabel, distractions, sessionStartedAt, plannedMinutes: cfg.focus, paused: !timer, remaining });
  }
  function clearActive() { localStorage.removeItem(ACTIVE_KEY); }
  function resumeIfActive() {
    const a = S.get(ACTIVE_KEY, null);
    if (!a) return;
    mode = a.mode; cycle = a.cycle; linkedType = a.linkedType; linkedId = a.linkedId; customLabel = a.customLabel;
    distractions = a.distractions; sessionId = a.sessionId; sessionStartedAt = a.sessionStartedAt;
    syncTaskSelect(); // show the restored task in the dropdown before anything (like finish) rebuilds it
    if (a.paused) { remaining = Math.max(1, Number(a.remaining) || modeSeconds(mode)); return; } // paused sessions stay paused after a refresh
    const left = Math.round((a.endsAt - Date.now()) / 1000);
    if (left > 0) { remaining = left; endsAt = a.endsAt; timer = setInterval(tick, 250); }
    else { remaining = 0; finish(true); }
  }

  // ---- Timer logic ----------------------------------------------------------
  function tick() {
    remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    if (remaining <= 0) return finish();
    draw();
  }
  function switchMode(m) { clearInterval(timer); timer = null; mode = m; remaining = modeSeconds(m); draw(); }
  function recordSession(status, completedMinutes) {
    const session = {
      id: sessionId || crypto.randomUUID(), linkedType: linkedType || null, linkedId: linkedId || null,
      title: currentTaskLabel() || null, plannedMinutes: cfg.focus, completedMinutes,
      startedAt: sessionStartedAt || D.isoNow(), completedAt: D.isoNow(), status, distractions,
    };
    const sessions = listOf(SESSIONS_KEY);
    sessions.push(session);
    S.set(SESSIONS_KEY, sessions.slice(-2000));
    window.dispatchEvent(new CustomEvent('nexora:focus-completed', { detail: session }));
    return session;
  }
  function stopEarly() {
    if (mode !== 'focus' || !sessionId) { clearInterval(timer); timer = null; clearActive(); return; }
    const elapsed = Math.max(0, Math.round((modeSeconds('focus') - remaining) / 60));
    clearInterval(timer); timer = null;
    if (elapsed > 0) recordSession('stopped', elapsed);
    clearActive(); sessionId = null; sessionStartedAt = null; distractions = 0; drawSummary();
  }
  // After a focus session: auto-complete a planner task once its planned minutes are logged,
  // otherwise ask. Works from a snapshot, so changing the dropdown later cannot mark the wrong task.
  function offerTaskDone(type, id, label) {
    taskPrompt.hidden = true;
    if ((type !== 'plan' && type !== 'overview') || !label) return;
    const total = minutesLogged(type, id), planned = plannedMinutes(type, id);
    if (planned && total >= planned) { completeTask(type, id); return say(`Task complete: ${label}.`); }
    taskPrompt.replaceChildren(h('span', '', `Is "${label}" finished? ${total}${planned ? ` of ${planned}` : ''} min logged so far.`));
    const row = h('div', 'nx-m3-chips');
    const yes = h('button', 'nx-m3-chip', 'Mark done'); yes.type = 'button';
    const no = h('button', 'nx-m3-chip', 'Not yet'); no.type = 'button';
    yes.onclick = () => { completeTask(type, id); taskPrompt.hidden = true; buildTaskSelect(); draw(); drawSummary(); say(currentTaskLabel() ? `Done! Next up: ${currentTaskLabel()}` : 'Task marked done.'); };
    no.onclick = () => { taskPrompt.hidden = true; };
    row.append(yes, no); taskPrompt.append(row); taskPrompt.hidden = false;
  }
  function finish(resumedAfterRefresh) {
    clearInterval(timer); timer = null;
    const wasFocus = mode === 'focus';
    if (wasFocus) {
      const label = currentTaskLabel(), doneType = linkedType, doneId = linkedId;
      recordSession('completed', cfg.focus);
      offerTaskDone(doneType, doneId, label);
      chime();
      notifyIfAllowed(`Session complete${label ? ` — ${label}` : ''}. Time for a break.`);
      if (!resumedAfterRefresh) say(`Focus session complete${label ? ` — ${label}` : ''}. ${((cycle + 1) % 4 === 0) ? 'Take a long break.' : 'Take a short break.'}`);
      cycle++;
      mode = cycle % 4 === 0 ? 'long' : 'short';
      buildTaskSelect();
    } else if (!resumedAfterRefresh) {
      chime(); notifyIfAllowed('Break over. Ready for the next focus session?');
      say('Break over. Ready for the next session?'); mode = 'focus';
    } else { mode = 'focus'; }
    sessionId = null; sessionStartedAt = null; distractions = 0; clearActive();
    remaining = modeSeconds(mode); draw(); drawSummary();
    if (wasFocus && cfg.autoBreak && !resumedAfterRefresh) startBtn.onclick(); // begin the break automatically (opt-in)
  }

  startBtn.onclick = () => {
    if (timer) { clearInterval(timer); timer = null; persistActive(); draw(); return; } // pause (state kept, resumable this tab only)
    if (fresh()) { sessionId = crypto.randomUUID(); sessionStartedAt = D.isoNow(); distractions = 0; }
    if (linkedType === 'custom') customLabel = customInput.value.trim();
    endsAt = Date.now() + remaining * 1000;
    timer = setInterval(tick, 250);
    if (mode === 'focus') persistActive();
    draw();
  };
  stopBtn.onclick = () => {
    if (!(mode === 'focus' && sessionId)) return;
    const elapsed = Math.max(0, Math.round((modeSeconds('focus') - remaining) / 60));
    if (elapsed > 0 && !confirm(`Stop now and save ${elapsed} minute${elapsed === 1 ? '' : 's'} of focus?`)) return;
    const label = currentTaskLabel(), doneType = linkedType, doneId = linkedId;
    stopEarly();
    if (elapsed > 0) offerTaskDone(doneType, doneId, label);
    remaining = modeSeconds(mode); draw();
  };
  // Reset restarts the clock WITHOUT saving; use "Stop & save" to keep the minutes already focused.
  resetBtn.onclick = () => {
    if (fresh()) return;
    const elapsed = Math.round((modeSeconds(mode) - remaining) / 60);
    if (mode === 'focus' && sessionId && elapsed > 0 && !confirm('Reset the timer? The time so far will NOT be saved. (Use "Stop & save" to keep it.)')) return;
    clearInterval(timer); timer = null; clearActive();
    sessionId = null; sessionStartedAt = null; distractions = 0;
    remaining = modeSeconds(mode); draw();
  };
  skipBtn.onclick = () => {
    if (mode === 'focus' && sessionId && !fresh()) {
      if (!confirm('Skip this focus session and save your progress so far?')) return;
      stopEarly();
    } else { clearInterval(timer); timer = null; clearActive(); }
    mode = mode === 'focus' ? 'short' : 'focus'; remaining = modeSeconds(mode); draw();
  };
  taskSelect.onchange = () => { setLinked(taskSelect.value); customField.hidden = linkedType !== 'custom'; draw(); };
  customInput.oninput = () => { customLabel = customInput.value.trim(); draw(); };
  window.addEventListener('nexora:focus-completed', drawSummary);

  // ---- Distraction-free full screen --------------------------------------------
  let immersive = false, usedFullscreenApi = false;
  async function enterImmersive() {
    if (immersive) return;
    immersive = true; usedFullscreenApi = false;
    root.classList.add('nx-m3-immersive'); document.documentElement.classList.add('nx-m3-lock');
    fsBtn.textContent = 'Exit full screen'; fsBtn.setAttribute('aria-pressed', 'true');
    startBtn.focus(); // keyboard focus moves into the timer, so Space / Enter start and pause it
    if (root.requestFullscreen) { try { await root.requestFullscreen(); usedFullscreenApi = true; } catch (_) { /* overlay fallback */ } }
  }
  function exitImmersive() {
    if (!immersive) return;
    immersive = false; usedFullscreenApi = false;
    root.classList.remove('nx-m3-immersive'); document.documentElement.classList.remove('nx-m3-lock');
    fsBtn.textContent = 'Full screen'; fsBtn.setAttribute('aria-pressed', 'false'); fsBtn.focus();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  fsBtn.onclick = () => (immersive ? exitImmersive() : enterImmersive());
  document.addEventListener('fullscreenchange', () => { if (immersive && usedFullscreenApi && !document.fullscreenElement) exitImmersive(); });
  window.addEventListener('hashchange', exitImmersive);
  document.addEventListener('keydown', e => {
    if (root.hidden) return;
    if (e.key === 'Escape' && immersive) { exitImmersive(); return; }
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); startBtn.onclick(); } // Space starts / pauses
  });

  // Overview card buttons drive the same timer (app.js already navigates to #focus on click)
  document.getElementById('nx-focus-start')?.addEventListener('click', () => { if (!timer) startBtn.onclick(); });
  document.getElementById('nx-focus-reset')?.addEventListener('click', () => resetBtn.onclick());

  buildPresets(); buildTaskSelect(); draw(); drawSummary(); resumeIfActive(); syncTaskSelect(); draw();
  NexoraRegisterPage('focus', root, () => { buildTaskSelect(); drawSummary(); draw(); });
})();
