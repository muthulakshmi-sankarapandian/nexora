/* Nexora Module 3 — shared core. Must load AFTER app.js (with defer): it mounts into #nx-main, which app.js creates. */
(() => {
  // Safe localStorage read/write — every component keys off this.
  window.NexoraStore = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; }
      catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (_) { return false; }
    },
  };

  const pad = n => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return dayKey(d); };
  // isoDay: the LOCAL calendar day of a timestamp. Slicing the UTC string would file a 2 a.m. IST session under "yesterday".
  // Date-only strings (e.g. planner task dates "2026-10-04") are already a calendar day and are returned unchanged.
  const isoDay = iso => {
    if (!iso) return '';
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s.slice(0, 10) : dayKey(d);
  };
  window.NexoraDate = { dayKey, addDays, isoNow: () => new Date().toISOString(), isoDay };

  // Safe DOM builder (user text always goes through textContent).
  window.NexoraH = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  // Labelled form field: <label><span>Text</span>{control}<small>help</small></label>
  window.NexoraField = (labelText, control, help) => {
    const l = window.NexoraH('label', 'nx-m3-field');
    l.append(window.NexoraH('span', '', labelText), control);
    if (help) l.append(window.NexoraH('small', 'nx-m3-sub', help));
    return l;
  };
  // Accessible progress bar (0..1)
  window.NexoraProgress = (fraction, label) => {
    const pct = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100);
    const track = window.NexoraH('div', 'nx-m3-progress');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label);
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(pct));
    const fill = window.NexoraH('div', 'nx-m3-progress-fill'); fill.style.width = `${pct}%`;
    track.append(fill);
    return track;
  };
  window.NexoraSay = msg => { if (typeof toast === 'function') toast(msg); };

  // Page registry: app.js navigate() shows/hides these.
  const pages = (window.NexoraPages = window.NexoraPages || {});
  window.NexoraRegisterPage = (id, el, onShow) => {
    const attach = () => {
      const main = document.getElementById('nx-main');
      if (!main) return console.error(`Nexora: #nx-main not found, cannot mount "${id}".`);
      main.append(el);
      pages[id] = { el, onShow };
      const active = (location.hash.slice(1) || 'overview') === id;
      el.hidden = !active;
      if (active) { const ph = document.getElementById('nx-module'); if (ph) ph.hidden = true; onShow && onShow(); }
    };
    // app.js builds the page shell; if it has not run yet, wait for it.
    if (document.getElementById('nx-main')) attach();
    else window.addEventListener('DOMContentLoaded', attach, { once: true });
  };
})();
