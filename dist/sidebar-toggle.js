/* Nexora — collapsible sidebar (desktop).
   Adds a hamburger button to the top bar that shrinks the left navigation to a slim icon rail and back.
   - Load AFTER app.js (it needs the dashboard shell that app.js builds).
   - State is remembered in localStorage ("nexora-sidebar-collapsed"); the early inline script in index.html
     applies it before first paint so the page does not flash.
   - Below 900px the existing mobile hamburger / drawer is used instead and this button is hidden (see module3.css). */
(() => {
  const KEY = 'nexora-sidebar-collapsed';
  const root = document.documentElement;
  const start = document.querySelector('.nx-topbar-start');
  const sidebar = document.getElementById('nx-sidebar');
  if (!start || !sidebar || document.getElementById('nx-rail-toggle')) return;

  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === '1'; } catch (_) { /* storage unavailable: start expanded */ }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'nx-rail-toggle';
  btn.className = 'nx-icon-button nx-rail-toggle';
  btn.setAttribute('aria-controls', 'nx-sidebar');
  btn.innerHTML = '<svg class="nx-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  start.prepend(btn);

  const links = [...sidebar.querySelectorAll('.nx-nav-link')];
  const theme = sidebar.querySelector('.nx-theme-control');

  function apply() {
    root.classList.toggle('nx-rail', collapsed);
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', label);
    btn.title = label;
    // In the icon rail the text labels are visually hidden, so show them as tooltips instead.
    links.forEach(a => {
      const text = a.querySelector('span')?.textContent?.trim();
      if (collapsed && text) a.title = text; else a.removeAttribute('title');
    });
    if (theme) { if (collapsed) theme.title = 'Switch light / dark mode'; else theme.removeAttribute('title'); }
  }

  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (_) { /* still works for this visit */ }
    apply();
  });

  apply();
  // Turn transitions on only after the first paint, so restoring a saved state never animates.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('nx-rail-anim')));
})();
