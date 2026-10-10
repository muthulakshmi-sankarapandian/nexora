let nexoraSessionId = '';
try {
  nexoraSessionId = sessionStorage.getItem('nexora-session-id') || crypto.randomUUID();
  sessionStorage.setItem('nexora-session-id',nexoraSessionId);
} catch (_) { nexoraSessionId = crypto.randomUUID(); }
window.NexoraSession = {id:nexoraSessionId};

const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  vault: '<path d="M3 6h6l2 2h10v11H3z"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h3m3 0h3"/>',
  summarizer: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2m-8-5 4 3-4 3z"/>',
  flashloop: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8m-8 4h5M3 6v12m18-12v12"/>',
  quiz: '<path d="M5 3h14v18H5zM8 8h5m-5 5 2 2 4-4m2 4h1"/>',
  assistant: '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8m-8 3h5"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8m0 5 3 2M9 2h6m4 3 2-2"/>',
  analytics: '<path d="M3 20h18M6 17v-5m6 5V7m6 10V4"/>',
  pattern: '<path d="M3 20h18M6 16l5-5 4 3 5-7"/><circle cx="6" cy="16" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="15" cy="14" r="1"/><circle cx="20" cy="7" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17m10-10 2.1-2.1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 15.8A8 8 0 0 1 8.2 4 8 8 0 1 0 20 15.8z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9zM10 21h4"/>',
  upload: '<path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M7 4v16m10-16v16"/>'
};
const icon = (name, className = '') => `<svg class="nx-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const modules = [
  {id:'vault',name:'Vault',group:'Study workspace',short:'Course files in one place',detail:'Store PDFs, syllabi, assignment sheets, lecture slides, and generated study notes.'},
  {id:'schedule',name:'SyllabusToSchedule',group:'Study workspace',short:'A plan from your syllabus',detail:'Turn course documents and exam dates into a practical daily study schedule.'},
  {id:'summarizer',name:'One-Shot Summarizer',group:'Study workspace',short:'Lectures become study notes',detail:'Turn long YouTube lectures into timestamped notes you can export and save in Vault.'},
  {id:'flashloop',name:'FlashLoop',group:'Study workspace',short:'Recall at the right time',detail:'Practice generated flashcards using SM-2 spaced repetition.'},
  {id:'quiz',name:'NoteToQuiz',group:'Study workspace',short:'Practice from your notes',detail:'Generate MCQs, short answers, and term checks from uploaded notes.'},
  {id:'assistant',name:'AI Study Assistant',group:'Focus & insights',short:'Answers with sources',detail:'Ask questions grounded in uploaded files, with file and page citations.'},
  {id:'focus',name:'Focus Mode',group:'Focus & insights',short:'Study without switching',detail:'Use Pomodoro sessions connected to planned tasks and daily goals.'},
  {id:'analytics',name:'Progress Analytics',group:'Focus & insights',short:'See what needs work',detail:'Track topic mastery, study streaks, and weak areas.'},
  {id:'pattern',name:'Prof Pattern Detector',group:'Focus & insights',short:'Read the exam pattern',detail:'Analyze past-year question repetition, topic frequency, weightage, and revision priority.'}
];
const navLink = (item) => `<a class="nx-nav-link" href="#${item.id}" data-page="${item.id}">${icon(item.id)}<span>${item.name}</span></a>`;
const toolRow = (item) => `<a class="nx-tool-row" href="#${item.id}">${icon(item.id)}<span><strong>${item.name}</strong><small>${item.short}</small></span><span class="nx-row-arrow" aria-hidden="true">↗</span></a>`;
const bookLogo = `<svg class="nx-book" viewBox="0 0 210 174" aria-hidden="true">
  <path class="nx-book-left" d="M20 30 C47 25 70 39 101 65 L101 151 C73 132 47 123 20 127 Z"/>
  <path class="nx-book-right" d="M190 30 C163 25 140 39 109 65 L109 151 C137 132 163 123 190 127 Z"/>
  <path class="nx-book-base" d="M8 52 L17 50 L17 139 C50 131 78 142 105 162 C132 142 160 131 193 139 L193 50 L202 52 L202 153 C165 142 134 150 105 170 C76 150 45 142 8 153 Z"/>
  <path class="nx-book-shade" d="M47 41 L47 115 C63 117 78 125 92 136 L92 75 C76 58 62 47 47 41 Z"/>
  <path class="nx-book-n" d="M39 37 L57 45 L57 103 L89 137 L101 151 L101 65 L85 52 L85 105 L54 57 L39 49 Z"/>
  <g class="nx-flip-page"><path class="nx-book-page" d="M4 53 C24 30 47 17 89 8 L89 81 C52 88 27 101 4 116 Z" transform="translate(101 0)"/></g>
</svg>`;
document.body.innerHTML = `
  <a class="nx-skip-link" href="#nx-main">Skip to main content</a>
  <div class="nx-shell">
    <aside class="nx-sidebar" id="nx-sidebar" aria-label="Main navigation">
      <div class="nx-sidebar-top"><a class="nx-brand" href="#overview" aria-label="Nexora overview">${bookLogo}<span translate="no">Nexora</span></a><button class="nx-icon-button nx-close-nav" id="nx-close-nav" type="button" aria-label="Close navigation">${icon('close')}</button></div>
      <div class="nx-sidebar-scroll"><nav aria-label="Nexora pages">
        <div class="nx-nav-group"><p class="nx-nav-label">Workspace</p><a class="nx-nav-link" href="#overview" data-page="overview">${icon('overview')}<span>Overview</span></a></div>
        <div class="nx-nav-group"><p class="nx-nav-label">Study workspace</p>${modules.filter(m=>m.group==='Study workspace').map(navLink).join('')}</div>
        <div class="nx-nav-group"><p class="nx-nav-label">Focus & insights</p>${modules.filter(m=>m.group==='Focus & insights').map(navLink).join('')}</div>
      </nav></div>
      <div class="nx-sidebar-bottom"><a class="nx-nav-link" href="#settings" data-page="settings">${icon('settings')}<span>Settings</span></a><button class="nx-theme-control" id="nx-theme-control" type="button" aria-label="Dark mode"><span class="nx-theme-copy"><strong>Appearance</strong><small id="nx-theme-label">Light mode</small></span><span class="nx-theme-art" aria-hidden="true"><img class="nx-theme-day" src="./assets/theme-light.png" alt="" width="375" height="130"><img class="nx-theme-night" src="./assets/theme-dark.png" alt="" width="375" height="130"></span></button><div class="nx-profile"><span class="nx-avatar" id="nx-avatar" aria-hidden="true">?</span><span><strong id="nx-profile-name">Student</strong><small>Student workspace</small></span></div></div>
    </aside>
    <div class="nx-scrim" id="nx-scrim" hidden></div>
    <div class="nx-main-column">
      <header class="nx-topbar"><div class="nx-topbar-start"><button class="nx-icon-button nx-menu" id="nx-menu" type="button" aria-label="Open navigation" aria-controls="nx-sidebar" aria-expanded="false">${icon('menu')}</button><a class="nx-compact-brand" href="#overview" aria-label="Nexora overview">${bookLogo}</a><span class="nx-breadcrumb"><span class="nx-breadcrumb-root">Workspace</span><span class="nx-breadcrumb-divider">/</span><strong id="nx-breadcrumb-page">Overview</strong></span></div><div class="nx-topbar-actions"><button class="nx-icon-button" id="nx-notifications" type="button" aria-label="Notifications">${icon('bell')}</button><button class="nx-primary-button" id="nx-upload" type="button">${icon('upload')}<span>Upload material</span></button></div></header>
      <main id="nx-main" tabindex="-1">
        <section id="nx-overview" class="nx-overview" aria-labelledby="nx-page-title">
          <div class="nx-intro"><div><p class="nx-eyebrow" id="nx-date"></p><h1 id="nx-page-title">Your study desk.</h1><p>Pick up where you left off and make time for what matters today.</p></div><span class="nx-sample-badge">Sample workspace</span></div>
          <div class="nx-priority-grid">
            <section class="nx-plan" aria-labelledby="nx-plan-title"><div class="nx-section-head"><div><p class="nx-kicker">Plan for today</p><h2 id="nx-plan-title">Three things to move forward</h2></div><a class="nx-text-link" href="#schedule">Open planner ${icon('arrow')}</a></div>
              <div class="nx-plan-list">
                <label class="nx-plan-row"><input type="checkbox" name="review-patterns" data-task="0"><span class="nx-checkbox">${icon('check')}</span><span class="nx-plan-copy"><strong>Review design patterns notes</strong><small>Advanced Programming Practices · 45 min</small></span><span class="nx-plan-time">4:30 PM</span></label>
                <label class="nx-plan-row"><input type="checkbox" name="practice-unit-three" data-task="1"><span class="nx-checkbox">${icon('check')}</span><span class="nx-plan-copy"><strong>Practice Unit 3 questions</strong><small>Advanced Programming Practices · 30 min</small></span><span class="nx-plan-time">6:00 PM</span></label>
                <label class="nx-plan-row"><input type="checkbox" name="revise-flashcards" data-task="2"><span class="nx-checkbox">${icon('check')}</span><span class="nx-plan-copy"><strong>Revise 18 flashcards</strong><small>FlashLoop · 20 min</small></span><span class="nx-plan-time">8:00 PM</span></label>
              </div><div class="nx-plan-foot"><span id="nx-task-progress" aria-live="polite">0 of 3 completed</span><span>Exam preparation · this week</span></div>
            </section>
            <section class="nx-focus-panel" aria-labelledby="nx-focus-title"><p class="nx-kicker">Focus mode</p><h2 id="nx-focus-title">A clear 25 minutes.</h2><p>Work through your next study task without switching context.</p><output class="nx-clock" id="nx-clock">25:00</output><div class="nx-focus-actions"><button class="nx-focus-start" id="nx-focus-start" type="button">${icon('play')}<span>Start session</span></button><button class="nx-focus-reset" id="nx-focus-reset" type="button" hidden>Reset</button></div><div class="nx-focus-linked"><span>Linked task</span><strong>Review design patterns notes</strong></div></section>
          </div>
          <section class="nx-metrics" aria-label="Sample study snapshot"><div><span>Focus time</span><strong>2h 40m</strong><small>This week · sample</small></div><div><span>Tasks due</span><strong id="nx-metric-tasks">3</strong><small>Today · sample</small></div><div><span>Cards to revise</span><strong>18</strong><small>FlashLoop · sample</small></div><div><span>Materials saved</span><strong>24</strong><small>Vault · sample</small></div><div><span>Study streak</span><strong>12 days</strong><small>Sample activity</small></div></section>
          <section class="nx-tools" aria-labelledby="nx-tools-title"><div class="nx-section-head"><div><p class="nx-kicker">Explore Nexora</p><h2 id="nx-tools-title">Your learning tools</h2></div><p class="nx-section-note">Nine tools, one study workflow.</p></div><div class="nx-tool-groups">
            <div class="nx-tool-group"><div class="nx-group-heading"><span>01</span><h3>Organize & plan</h3></div>${modules.slice(0,3).map(toolRow).join('')}</div>
            <div class="nx-tool-group"><div class="nx-group-heading"><span>02</span><h3>Learn & practice</h3></div>${modules.slice(3,6).map(toolRow).join('')}</div>
            <div class="nx-tool-group"><div class="nx-group-heading"><span>03</span><h3>Focus & improve</h3></div>${modules.slice(6,9).map(toolRow).join('')}</div>
          </div></section>
        </section>
        <section id="nx-module" class="nx-module-view" aria-labelledby="nx-module-title" hidden><p class="nx-eyebrow" id="nx-module-group"></p><div class="nx-module-title-row"><h1 id="nx-module-title"></h1><span class="nx-status-pill">Feature in development</span></div><p class="nx-module-description" id="nx-module-description"></p><div class="nx-module-placeholder"><span class="nx-placeholder-rule"></span><h2>Workspace coming together</h2><p id="nx-module-detail"></p><a class="nx-secondary-button" href="#overview">Back to overview ${icon('arrow')}</a></div></section>
        <section id="nx-summarizer" class="nx-summarizer" aria-labelledby="nx-summarizer-title" hidden><p class="nx-eyebrow">Study workspace / One-Shot Summarizer</p><h1 id="nx-summarizer-title">Turn a YouTube lecture into study notes.</h1><p class="nx-module-description">Paste a video link. Nexora reads its title and captions, then makes clear, timestamped notes you can print or save.</p>
          <div class="nx-summarizer-layout"><form class="nx-caption-form" id="nx-caption-form"><div class="nx-section-head"><div><p class="nx-kicker">Source</p><h2>YouTube lecture</h2></div><span class="nx-step-mark">01 / Paste link</span></div><label for="nx-video-url">Video link</label><input id="nx-video-url" name="sourceUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://www.youtube.com/watch?v=..." required><p class="nx-form-help">The lecture title and available captions are collected automatically. No upload or transcript paste needed.</p><p class="nx-form-error" id="nx-summarizer-error" role="alert" hidden></p><button class="nx-primary-button nx-generate-button" id="nx-generate" type="submit">Generate study notes ${icon('arrow')}</button><p class="nx-source-footnote">Works with videos that have accessible captions.</p></form>
            <div class="nx-notes-column" id="nx-notes-column" hidden><div class="nx-notes-toolbar"><div><p class="nx-kicker">Output</p><h2>Your study guide</h2></div><span class="nx-step-mark" id="nx-note-status">Notes ready</span></div><article class="nx-study-note" id="nx-study-note" aria-live="polite"></article><div class="nx-notes-actions" id="nx-notes-actions"><button class="nx-secondary-button" id="nx-print-note" type="button">Open / Print PDF</button><button class="nx-secondary-button" id="nx-download-note" type="button">Download PDF</button><button class="nx-primary-button" id="nx-save-note" type="button">Save to Vault</button></div></div></div>
          <div class="nx-language-warning" id="nx-language-warning" role="status" hidden><span aria-hidden="true">!</span><p>The given URL is in Non English language</p><button type="button" id="nx-dismiss-language-warning" aria-label="Dismiss language warning">×</button></div>
        </section>
        <section id="nx-vault-notes" class="nx-module-view" aria-labelledby="nx-vault-title" hidden><p class="nx-eyebrow">Study workspace</p><h1 id="nx-vault-title">Vault</h1><p class="nx-module-description">Keep original course files, generated study notes, extracted question banks, and analysis reports in this browser.</p><form class="nx-vault-uploader" id="nx-vault-upload-form"><div><p class="nx-kicker">Add material</p><h2>Upload files to Vault</h2><p>Store PDFs, text files, syllabi, assignments, and lecture slides for later use.</p></div><label class="nx-file-picker" for="nx-vault-file-input"><span>Choose files</span><input id="nx-vault-file-input" type="file" accept=".pdf,.txt,.doc,.docx,.ppt,.pptx,application/pdf,text/plain" multiple required></label><button class="nx-primary-button" id="nx-vault-upload" type="submit">Save to Vault ${icon('upload')}</button><p class="nx-pattern-progress" id="nx-vault-upload-status" role="status" hidden></p></form><div class="nx-vault-list" id="nx-vault-list"></div></section>
        <section id="nx-pattern" class="nx-pattern" aria-labelledby="nx-pattern-title" hidden><p class="nx-eyebrow">Focus & insights / Prof Pattern Detector</p><h1 id="nx-pattern-title">See what your papers keep asking.</h1><p class="nx-module-description">Upload past question papers to spot repeated questions and marks weightage. These are historical counts, not predictions of the next exam.</p>
          <div class="nx-pattern-intro"><form id="nx-pattern-form" class="nx-pattern-form"><div class="nx-section-head"><div><p class="nx-kicker">Question bank</p><h2>Add papers</h2></div><span class="nx-step-mark">01 / Choose source</span></div><div class="nx-pattern-source-actions"><label class="nx-secondary-button nx-pattern-upload-label" for="nx-pattern-file">${icon('upload')} Upload files</label><button class="nx-secondary-button" id="nx-pattern-vault-open" type="button">${icon('vault')} Get from Vault</button></div><input class="nx-pattern-file-input" id="nx-pattern-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" multiple><div class="nx-pattern-selected-files" id="nx-pattern-selected-files" hidden></div><div class="nx-pattern-vault-picker" id="nx-pattern-vault-picker" hidden><p class="nx-kicker">Files in Vault</p><div id="nx-pattern-vault-files"></div><button class="nx-primary-button" id="nx-pattern-vault-add" type="button">Add selected from Vault ${icon('arrow')}</button></div><label for="nx-pattern-year">Fallback exam year <span class="nx-optional">optional</span></label><input id="nx-pattern-year" type="text" maxlength="20" placeholder="Used only when a filename has no year"><p class="nx-form-help">Select files together or add them in several batches. Years such as 2026 and 2025 are read from each filename automatically. Scans use Tesseract and NVIDIA OCR, then Gemini and Groq cross-check the extracted questions.</p><p class="nx-pattern-progress" id="nx-pattern-progress" role="status" hidden></p><p class="nx-form-error" id="nx-pattern-error" role="alert" hidden></p><button class="nx-primary-button" id="nx-pattern-add" type="submit">Analyze selected files ${icon('arrow')}</button></form><div class="nx-pattern-sources"><p class="nx-kicker">This session</p><h2>Included papers</h2><div id="nx-pattern-papers"></div></div></div>
          <div id="nx-pattern-results" class="nx-pattern-results" hidden><div class="nx-pattern-results-head"><div><p class="nx-kicker">Historical pattern</p><h2>Question-bank analysis</h2></div><p>Historical evidence supports revision priorities; it cannot predict the next exam.</p></div><div class="nx-pattern-stats" id="nx-pattern-stats"></div><div class="nx-pattern-charts"><section class="nx-pattern-card" aria-labelledby="nx-pattern-repeat-title"><h3 id="nx-pattern-repeat-title">Most repeated questions</h3><p>Number of distinct papers containing the question</p><div id="nx-pattern-repeat-chart"></div></section><section class="nx-pattern-card" aria-labelledby="nx-pattern-topic-title"><h3 id="nx-pattern-topic-title">Topics by marks</h3><p>Based on extracted marks only. Edit topic names in the question list.</p><div id="nx-pattern-topic-chart"></div></section><section class="nx-pattern-card" aria-labelledby="nx-pattern-trend-title"><h3 id="nx-pattern-trend-title">Repeated questions over time</h3><p>Share of questions in each year that match another paper.</p><div id="nx-pattern-trend-chart"></div></section><section class="nx-pattern-card" aria-labelledby="nx-pattern-share-title"><h3 id="nx-pattern-share-title">Topic share</h3><p>Share of all detected question occurrences. Top topics shown.</p><div id="nx-pattern-share-chart"></div></section></div><section class="nx-pattern-question-section" aria-labelledby="nx-pattern-questions-title"><div class="nx-pattern-results-head"><div><p class="nx-kicker">Question detail</p><h2 id="nx-pattern-questions-title">All question groups</h2></div><label class="nx-pattern-filter" for="nx-pattern-sort">Explore <select id="nx-pattern-sort"><option value="frequency">Most repeated</option><option value="least-frequency">Least repeated</option><option value="marks">Highest marks</option><option value="least-marks">Lowest marks</option><option value="important">Most important topics</option><option value="least-important">Least important topics</option></select></label></div><div class="nx-pattern-ai-row"><button class="nx-secondary-button" id="nx-pattern-ai" type="button">Label topics with Gemini + Groq</button><p id="nx-pattern-ai-status" role="status">Importance uses observed repetitions and marks; AI helps label topics.</p></div><div id="nx-pattern-questions"></div></section></div>
        </section>
        <section id="nx-assistant" class="nx-assistant" aria-labelledby="nx-assistant-title" hidden>
          <p class="nx-eyebrow">Focus & insights / AI Study Assistant</p>
          <div class="nx-assistant-heading"><div><h1 id="nx-assistant-title">Ask your study companion.</h1><p class="nx-module-description">Get clear explanations from general academic knowledge. Vault-grounded answers and page citations will arrive with the RAG stage.</p></div><span class="nx-status-pill">General study chat</span></div>
          <section class="nx-assistant-chat-shell" aria-label="Study assistant chat"><header><div class="nx-assistant-avatar" id="nx-assistant-avatar-preview" aria-hidden="true"></div><div><p class="nx-kicker">Your companion</p><h2 id="nx-assistant-avatar-title">Study companion</h2><p id="nx-assistant-avatar-copy">Ready to help with your questions.</p></div><button class="nx-secondary-button" id="nx-assistant-customize" type="button">Customize avatar</button></header><div class="nx-chat-messages nx-chat-messages-page" id="nx-page-chat-messages" aria-live="polite"></div><div class="nx-chat-suggestions" id="nx-page-chat-suggestions"></div><form class="nx-chat-form nx-chat-form-page" id="nx-page-chat-form"><label class="nx-sr-only" for="nx-page-chat-input">Ask a study question</label><textarea id="nx-page-chat-input" rows="2" maxlength="3000" placeholder="Ask a concept, request an example, or plan a revision topic…" required></textarea><button class="nx-primary-button" type="submit">Send</button></form><p class="nx-chat-disclaimer">AI can make mistakes. Verify important academic details with your course material.</p></section>
        </section>
        <section id="nx-settings" class="nx-module-view" aria-labelledby="nx-settings-title" hidden><p class="nx-eyebrow">Workspace preferences</p><h1 id="nx-settings-title">Settings</h1><p class="nx-module-description">Make this study space yours.</p><div class="nx-module-placeholder nx-settings-card"><span class="nx-placeholder-rule"></span><h2>Your profile</h2><p>Your name appears in the greeting and sidebar. It is saved only in this browser.</p><div class="nx-settings-row"><span><small>Display name</small><strong id="nx-settings-name">Student</strong></span><button class="nx-secondary-button" id="nx-edit-name" type="button">Change name</button></div></div></section>
      </main>
    </div>
  </div><dialog class="nx-name-dialog" id="nx-name-dialog" aria-labelledby="nx-name-title" aria-describedby="nx-name-description"><form id="nx-name-form" novalidate><span class="nx-placeholder-rule"></span><p class="nx-kicker">Nexora workspace</p><h2 id="nx-name-title">Welcome to Nexora</h2><p id="nx-name-description">What should we call you? Your name will appear on your dashboard and stay in this browser.</p><label for="nx-name-input">Your name</label><input id="nx-name-input" name="display-name" type="text" autocomplete="name" maxlength="40" aria-describedby="nx-name-error" required><p class="nx-field-error" id="nx-name-error" role="alert" hidden>Please enter your name.</p><div class="nx-dialog-actions"><button class="nx-secondary-button" id="nx-name-cancel" type="button" hidden>Cancel</button><button class="nx-primary-button" id="nx-name-submit" type="submit">Continue to dashboard</button></div></form></dialog><div class="nx-toast" id="nx-toast" role="status" aria-live="polite" hidden></div>`;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const nameDialog = $('#nx-name-dialog');
const nameInput = $('#nx-name-input');
const normalizeName = (value) => value.replace(/\s+/g, ' ').trim();
let displayName = '';
try { displayName = normalizeName(localStorage.getItem('nexora-display-name') || '').slice(0, 40); } catch (_) {}
function renderName() {
  $('#nx-page-title').textContent = displayName ? `Your study desk, ${displayName}.` : 'Your study desk.';
  $('#nx-profile-name').textContent = displayName || 'Student';
  $('#nx-settings-name').textContent = displayName || 'Student';
  $('#nx-avatar').textContent = displayName ? Array.from(displayName)[0].toLocaleUpperCase() : '?';
}
function openNameDialog(edit = false) {
  nameDialog.dataset.mode = edit ? 'edit' : 'welcome';
  $('#nx-name-title').textContent = edit ? 'Change your name' : 'Welcome to Nexora';
  $('#nx-name-description').textContent = edit ? 'Update the name shown in your dashboard and sidebar.' : 'What should we call you? Your name will appear on your dashboard and stay in this browser.';
  $('#nx-name-submit').textContent = edit ? 'Save name' : 'Continue to dashboard';
  $('#nx-name-cancel').hidden = !edit;
  $('#nx-name-error').hidden = true;
  nameInput.removeAttribute('aria-invalid');
  nameInput.value = edit ? displayName : '';
  nameDialog.showModal();
  nameInput.focus();
}
function validateName() {
  const valid = Boolean(normalizeName(nameInput.value));
  $('#nx-name-error').hidden = valid;
  if (valid) nameInput.removeAttribute('aria-invalid'); else nameInput.setAttribute('aria-invalid', 'true');
  return valid;
}
nameInput.addEventListener('blur', () => { if (nameInput.value) validateName(); });
nameInput.addEventListener('input', () => { if (nameInput.getAttribute('aria-invalid') === 'true') validateName(); });
nameDialog.addEventListener('cancel', (event) => { if (!displayName) event.preventDefault(); });
$('#nx-name-cancel').addEventListener('click', () => nameDialog.close());
$('#nx-name-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validateName()) { nameInput.focus(); return; }
  displayName = normalizeName(nameInput.value).slice(0, 40);
  let saved = true;
  try { localStorage.setItem('nexora-display-name', displayName); } catch (_) { saved = false; }
  renderName();
  nameDialog.close();
  if (!saved) toast('Browser storage is unavailable. Your name will last for this visit only.');
});
$('#nx-edit-name').addEventListener('click', () => openNameDialog(true));
renderName();
if (!displayName) openNameDialog();
function renderTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#020608' : '#f5fafb';
  $('#nx-theme-control').setAttribute('aria-pressed', String(dark));
  $('#nx-theme-label').textContent = dark ? 'Dark mode' : 'Light mode';
}
$('#nx-theme-control').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  const art = $('.nx-theme-art');
  clearTimeout(art.motionTimer);
  art.classList.remove('nx-to-dark', 'nx-to-light');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    art.classList.add(next === 'dark' ? 'nx-to-dark' : 'nx-to-light');
    art.motionTimer = setTimeout(() => art.classList.remove('nx-to-dark', 'nx-to-light'), 720);
  }
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('nexora-theme', next); } catch (_) {}
  renderTheme();
});
renderTheme();
const dateFormatter = new Intl.DateTimeFormat('en-IN', {weekday:'long', day:'numeric', month:'long'});
$('#nx-date').textContent = dateFormatter.format(new Date());
function closeNav() {
  $('#nx-sidebar').classList.remove('nx-open');
  $('#nx-scrim').hidden = true;
  $('#nx-menu').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nx-drawer-open');
  $('.nx-main-column').inert = false;
}
$('#nx-menu').addEventListener('click', () => {
  $('#nx-sidebar').classList.add('nx-open');
  $('#nx-scrim').hidden = false;
  $('#nx-menu').setAttribute('aria-expanded', 'true');
  document.body.classList.add('nx-drawer-open');
  $('.nx-main-column').inert = true;
  $('#nx-close-nav').focus();
});
$('#nx-close-nav').addEventListener('click', () => { closeNav(); $('#nx-menu').focus(); });
$('#nx-scrim').addEventListener('click', closeNav);
$$('.nx-sidebar .nx-nav-link').forEach(link => link.addEventListener('click', closeNav));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#nx-sidebar').classList.contains('nx-open')) { closeNav(); $('#nx-menu').focus(); } });
function navigate() {
  const id = location.hash.slice(1) || 'overview';
  const module = modules.find(m => m.id === id);
  const title = id === 'overview' ? 'Overview' : module?.name || (id === 'settings' ? 'Settings' : 'Overview');
  const actual = id === 'overview' || module || id === 'settings' ? id : 'overview';
  $('#nx-overview').hidden = actual !== 'overview';
  const custom = window.NexoraPages || {};
  $('#nx-module').hidden = actual === 'overview' || actual === 'settings' || actual === 'summarizer' || actual === 'vault' || actual === 'pattern' || actual === 'assistant' || actual in custom;
  Object.entries(custom).forEach(([pid, p]) => { p.el.hidden = actual !== pid; if (actual === pid && p.onShow) p.onShow(); });  $('#nx-summarizer').hidden = actual !== 'summarizer';
  $('#nx-vault-notes').hidden = actual !== 'vault';
  $('#nx-pattern').hidden = actual !== 'pattern';
  $('#nx-assistant').hidden = actual !== 'assistant';
  $('#nx-settings').hidden = actual !== 'settings';
  $('#nx-breadcrumb-page').textContent = title;
  document.title = `Nexora — ${title}`;
  $$('.nx-nav-link').forEach(link => {
    const selected = link.dataset.page === actual;
    link.classList.toggle('nx-active', selected);
    if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  if (module) {
    $('#nx-module-group').textContent = module?.group || 'Workspace';
    $('#nx-module-title').textContent = title;
    $('#nx-module-description').textContent = module?.short || 'Choose how Nexora works for you.';
    $('#nx-module-detail').textContent = module?.detail || 'Settings will be available as the team builds the full application.';
  }
  if (actual === 'vault') renderVault();
  closeNav();
  window.scrollTo({top:0,behavior:'auto'});
}
window.addEventListener('hashchange', () => { navigate(); $('#nx-main').focus({preventScroll:true}); });
navigate();
function toast(message) {
  const el = $('#nx-toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3600);
}
$('#nx-upload').addEventListener('click', () => { location.hash = '#vault'; requestAnimationFrame(() => $('#nx-vault-file-input')?.focus()); });
$('#nx-notifications').addEventListener('click', () => toast('No notifications in this sample workspace.'));
const checks = $$('[data-task]');
let savedTasks = [];
try { savedTasks = JSON.parse(localStorage.getItem('nexora-sample-tasks') || '[]'); } catch (_) {}
checks.forEach((check, index) => { check.checked = Boolean(savedTasks[index]); check.addEventListener('change', () => {
  const state = checks.map(item => item.checked);
  try { localStorage.setItem('nexora-sample-tasks', JSON.stringify(state)); } catch (_) {}
  renderTasks();
}); });
function renderTasks() {
  const completed = checks.filter(item => item.checked).length;
  $('#nx-task-progress').textContent = `${completed} of ${checks.length} completed`;
  $('#nx-metric-tasks').textContent = String(checks.length - completed);
}
renderTasks();
$('#nx-focus-start').addEventListener('click', () => { location.hash = '#focus'; });


const captionForm = $('#nx-caption-form');
let currentNote = null;
function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}
function containsLatex(value) {
  if (typeof value === 'string') {
    const withoutCurrency = value.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, '');
    return /\${1,2}|\\(?:frac|sqrt|sum|prod|int|lim|begin|end|text|mathrm|mathbf|mathit|left|right|cdot|times|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega)\b|\\[A-Za-z]+\s*[\[{]|\\[()[\]{}]|[\^_]\s*\{/i.test(withoutCurrency);
  }
  if (Array.isArray(value)) return value.some(containsLatex);
  if (value && typeof value === 'object') return Object.values(value).some(containsLatex);
  return false;
}
function timeLink(timestamp, sourceUrl) {
  const label = node('span', 'nx-note-timestamp', timestamp || 'Topic');
  if (!timestamp || !sourceUrl) return label;
  const match = timestamp.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!match) return label;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const link = node('a', 'nx-note-timestamp', timestamp);
  const url = new URL(sourceUrl);
  url.searchParams.set('t', String(seconds));
  link.href = url.toString();
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Watch lecture from ${timestamp}`);
  return link;
}
function renderNote(note) {
  const article = $('#nx-study-note');
  article.replaceChildren();
  article.append(node('p', 'nx-note-label', 'Nexora study guide'));
  article.append(node('h2', '', note.title));
  article.append(node('p', 'nx-note-overview', note.overview));
  const source = node('p', 'nx-note-source', `Generated ${new Date(note.createdAt).toLocaleDateString('en-IN')}${note.sourceUrl ? ' · YouTube lecture' : ''}${note.provider ? ` · ${note.provider}` : ''}`);
  article.append(source);
  note.sections.forEach((section, index) => {
    const wrapper = node('section', 'nx-note-section');
    wrapper.append(timeLink(section.timestamp, note.sourceUrl));
    wrapper.append(node('h3', '', `${String(index + 1).padStart(2, '0')}  ${section.heading}`));
    const list = node('ul');
    section.points.forEach(point => list.append(node('li', '', point)));
    wrapper.append(list);
    article.append(wrapper);
  });
  const recap = node('section', 'nx-note-section nx-note-recap');
  recap.append(node('h3', '', 'Key takeaways'));
  const list = node('ul');
  note.takeaways.forEach(item => list.append(node('li', '', item)));
  recap.append(list);
  article.append(recap);
  $('#nx-notes-column').hidden = false;
  $('#nx-summarizer').classList.add('nx-has-notes');
  $('#nx-note-status').textContent = 'Notes ready';
}
$('#nx-dismiss-language-warning').addEventListener('click', () => { $('#nx-language-warning').hidden = true; });
captionForm.addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('#nx-summarizer-error');
  error.hidden = true;
  const sourceUrl = $('#nx-video-url').value.trim();
  if (!sourceUrl) { error.textContent = 'Paste a YouTube video link.'; error.hidden = false; $('#nx-video-url').focus(); return; }
  $('#nx-language-warning').hidden = true;
  const button = $('#nx-generate');
  button.disabled = true;
  button.textContent = 'Reading lecture…';
  $('#nx-note-status').textContent = 'Reading captions and writing notes…';
  try {
    const response = await fetch('/api/summarize', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceUrl})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not generate notes.');
    if (containsLatex(result.notes)) throw new Error('The notes contained LaTeX notation. Please generate again.');
    currentNote = result.notes;
    renderNote(currentNote);
    $('#nx-language-warning').hidden = !result.languageWarning;
    toast('Study notes are ready. Review them before saving.');
  } catch (problem) {
    error.textContent = problem.message === 'Failed to fetch' ? 'Open Nexora through the local server, not the HTML file. Run npm start.' : problem.message;
    error.hidden = false;
    if (currentNote) $('#nx-note-status').textContent = 'Previous notes shown';
  } finally {
    button.disabled = false;
    button.innerHTML = `Generate study notes ${icon('arrow')}`;
  }
});
function getVaultNotes() {
  try { const notes = JSON.parse(localStorage.getItem('nexora-vault-notes') || '[]'); return Array.isArray(notes) ? notes : []; } catch (_) { return []; }
}
function getVaultItems(key) {
  try { const items=JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(items) ? items : []; } catch (_) { return []; }
}
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function openVaultFile(file) {
  const url=URL.createObjectURL(file.blob);
  const viewer=window.open(url,'_blank');
  if (!viewer) toast('Allow pop-ups to open this Vault file.');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function downloadVaultFile(file) {
  const url=URL.createObjectURL(file.blob); const link=document.createElement('a');
  link.href=url; link.download=file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
function studyGuidePdf(note) {
  if (!note || containsLatex(note)) throw new Error('Cannot export notes containing LaTeX notation.');
  return window.NexoraPdf.createStudyGuidePdf(note, window.jspdf?.jsPDF);
}
function openStudyGuidePdf(note) {
  const viewer = window.open('', '_blank');
  if (!viewer) return toast('Allow pop-ups for Nexora to open the PDF. You can still use Download PDF.');
  try {
    const url = URL.createObjectURL(studyGuidePdf(note).output('blob'));
    viewer.location.href = url;
  } catch (error) { viewer.close(); toast(error.message || 'Could not open this PDF.'); }
}
function downloadStudyGuidePdf(note) {
  try { studyGuidePdf(note).save(window.NexoraPdf.filename(note)); }
  catch (error) { toast(error.message || 'Could not download this PDF.'); }
}
async function renderVault() {
  const list = $('#nx-vault-list');
  list.replaceChildren();
  let notes = getVaultNotes();
  let papers = getVaultItems('nexora-vault-papers');
  let reports = getVaultItems('nexora-vault-pattern-reports');
  let files=[];
  try { files=await window.NexoraVaultFileStore.list(); }
  catch (_) { toast('Original files could not be read from browser storage.'); }
  if (!notes.length && !papers.length && !reports.length && !files.length) {
    const empty = node('div', 'nx-module-placeholder');
    empty.append(node('h2', '', 'Your Vault is empty'));
    empty.append(node('p', '', 'Generate study notes or analyze question papers, then save the result here.'));
    const link = node('a', 'nx-secondary-button', 'Open One-Shot Summarizer');
    link.href = '#summarizer';
    empty.append(link);
    list.append(empty);
    return;
  }
  const section = title => { const heading=node('h2','nx-vault-heading',title); list.append(heading); };
  const subsection = title => { const heading=node('h3','nx-vault-subheading',title); list.append(heading); };
  const actions = (...buttons) => { const row=node('div','nx-vault-actions'); row.append(...buttons); return row; };
  const actionButton = (label,handler,primary=false) => { const button=node('button',primary?'nx-primary-button':'nx-secondary-button',label); button.type='button'; button.addEventListener('click',handler); return button; };
  const renderFileCard = file => {
    const card=node('article','nx-vault-item');
    const canAnalyze=/\.(pdf|txt)$/i.test(file.name);
    card.append(node('span','nx-vault-item-type','ORIGINAL FILE'),node('strong','',file.name),node('small','',`${formatFileSize(file.size)} · ${new Date(file.createdAt).toLocaleDateString('en-IN')}`));
    const fileActions=[actionButton('Open',()=>openVaultFile(file),true),actionButton('Download',()=>downloadVaultFile(file))];
    if (canAnalyze) fileActions.push(actionButton('Use in detector',()=>{location.hash='#pattern';requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('nexora:restore-vault-files',{detail:[file.id]})));}));
    fileActions.push(actionButton('Remove',async()=>{await window.NexoraVaultFileStore.remove(file.id);toast(`${file.name} removed from Vault.`);}));
    card.append(actions(...fileActions)); list.append(card);
  };
  const renderReportCard = report => {
    const card=node('article','nx-vault-item');
    card.append(node('span','nx-vault-item-type','PDF ANALYSIS REPORT'),node('strong','',report.title || 'Prof Pattern Analysis'),node('small','',`${report.analysis?.paperCount || report.papers?.length || 0} papers · ${new Date(report.createdAt).toLocaleDateString('en-IN')}`));
    card.append(actions(actionButton('Open PDF',()=>window.dispatchEvent(new CustomEvent('nexora:open-pattern-pdf',{detail:report})),true),actionButton('Load analysis',()=>{location.hash='#pattern';requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('nexora:restore-report',{detail:report})));})));
    list.append(card);
  };
  const renderPaperCard = paper => {
    const card=node('article','nx-vault-item');
    card.append(node('span','nx-vault-item-type','EXTRACTED QUESTION BANK'),node('strong','',paper.filename),node('small','',`${paper.questions?.length || 0} questions · ${paper.year || 'No year'} · ${paper.processing || 'Text extraction'}`));
    card.append(actions(actionButton('Add to detector',()=>{location.hash='#pattern';requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('nexora:restore-paper',{detail:paper})));},true)));
    list.append(card);
  };
  const renderNoteCard = note => {
    const card = node('article', 'nx-vault-item');
    card.append(node('span', 'nx-vault-item-type', 'PDF STUDY GUIDE'),node('strong', '', note.title),node('small', '', `${note.sections.length} sections · ${new Date(note.createdAt).toLocaleDateString('en-IN')}`));
    card.append(actions(actionButton('Open PDF',()=>openStudyGuidePdf(note),true),actionButton('Download',()=>downloadStudyGuidePdf(note))));
    list.append(card);
  };
  const sessionId=window.NexoraSession?.id;
  const isCurrent=item=>Boolean(sessionId && item?.sessionId===sessionId);
  const current={files:files.filter(isCurrent),reports:reports.filter(isCurrent),papers:papers.filter(isCurrent),notes:notes.filter(isCurrent)};
  if (Object.values(current).some(items=>items.length)) {
    section('In this session');
    const note=node('p','nx-vault-session-note','These working items stay grouped here until this browser session ends. Next time, they will appear in the normal Vault sections below.'); list.append(note);
    if (current.files.length) { subsection('Uploaded files'); current.files.forEach(renderFileCard); }
    if (current.papers.length) { subsection('Question banks'); current.papers.sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)).forEach(renderPaperCard); }
    if (current.reports.length) { subsection('Pattern reports'); current.reports.forEach(renderReportCard); }
    if (current.notes.length) { subsection('Study notes'); current.notes.forEach(renderNoteCard); }
  }
  files=files.filter(item=>!isCurrent(item)); reports=reports.filter(item=>!isCurrent(item)); papers=papers.filter(item=>!isCurrent(item)); notes=notes.filter(item=>!isCurrent(item));
  if (files.length) {
    section('Uploaded files');
    files.forEach(renderFileCard);
  }
  if (reports.length) {
    section('Pattern reports');
    reports.forEach(renderReportCard);
  }
  if (papers.length) {
    section('Question banks');
    papers.sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)).forEach(renderPaperCard);
  }
  if (notes.length) section('Study notes');
  notes.forEach(renderNoteCard);
}
window.addEventListener('nexora:vault-updated',() => { if(location.hash==='#vault') renderVault(); });
$('#nx-vault-upload-form').addEventListener('submit',async event => {
  event.preventDefault();
  const input=$('#nx-vault-file-input'); const status=$('#nx-vault-upload-status'); const button=$('#nx-vault-upload'); const files=[...(input.files || [])];
  if (!files.length) return;
  if (files.some(file=>file.size>25_000_000)) return toast('Each Vault file must be under 25 MB.');
  button.disabled=true; status.hidden=false; status.textContent=`Saving ${files.length} file${files.length===1?'':'s'} to Vault…`;
  try { await window.NexoraVaultFileStore.putMany(files); input.value=''; status.textContent=`Saved ${files.length} file${files.length===1?'':'s'} to Vault.`; toast('Files saved to Vault.'); }
  catch (problem) { status.textContent=problem.message || 'Could not save these files to Vault.'; }
  finally { button.disabled=false; }
});
$('#nx-save-note').addEventListener('click', () => {
  if (!currentNote || containsLatex(currentNote)) return toast('Cannot save notes containing LaTeX notation.');
  const notes = getVaultNotes();
  if (!currentNote.id) currentNote.id = crypto.randomUUID();
  currentNote.sessionId=window.NexoraSession?.id || null;
  const next = [currentNote, ...notes.filter(note => note.id !== currentNote.id)].slice(0, 20);
  try { localStorage.setItem('nexora-vault-notes', JSON.stringify(next)); toast('Saved to Vault. Click it there to open its PDF.'); }
  catch (_) { toast('Browser storage is full or unavailable. Download the PDF instead.'); }
});
$('#nx-print-note').addEventListener('click', () => {
  if (currentNote) openStudyGuidePdf(currentNote);
});
$('#nx-download-note').addEventListener('click', () => { if (currentNote) downloadStudyGuidePdf(currentNote); });
