# Nexora dashboard

This is the Nexora smart student-helper dashboard. The One-Shot Summarizer, Prof Pattern Detector, and browser-local Vault are currently functional. Use Node.js 24 or newer. Run `npm install`, copy `server/.env.example` to `server/.env`, add the required provider keys, then run `npm start` and open `http://127.0.0.1:4173`. API keys are read only by the local server; `server/.env` is ignored by Git. Run `npm test` for the offline tests.

## What's working

- Nine module links in the sidebar and overview. One-Shot Summarizer and Prof Pattern Detector are functional; the others are placeholders except for the browser-local Vault.
- One-Shot Summarizer accepts a YouTube video link only. The local server retrieves the video's title and available captions, sends the timestamped captions to Gemini (3.8 Flash → 3.7 Flash → 3.6 Flash when a model is busy), and can use Groq as a second provider (GPT-OSS 120B → 20B when busy). It renders timestamped study notes only after generation, blocks LaTeX notation, and creates an A4 PDF with section headings, page numbers, and source details. You can open/print or download that PDF. Using Groq sends the captions to Groq; provider rate limits may restrict long lectures.
- A small non-English warning appears if the selected source captions are not English. Generation continues automatically and notes are written in English. Videos without accessible captions cannot be summarized in this flow.
- Generated notes can be saved to the browser-local Vault. Clicking a saved guide opens its PDF in a new tab, including guides saved before this update. Original PDFs, text files, syllabi, assignments, and lecture slides are stored in IndexedDB. The Prof Pattern Detector can upload new papers or retrieve PDF/TXT files from Vault; new detector uploads are automatically retained there. The Vault also stores extracted question banks and complete pattern-analysis reports. Data remains in this browser and does not sync across devices.
- Prof Pattern Detector accepts multiple PDF or TXT question papers in one selection (up to 12 MB and 25 PDF pages per file, and 30 papers in one analysis). Text-based pages are read directly. Scanned pages are rendered with PDF.js' bundled JBIG2 decoder, then read by local Tesseract and NVIDIA OCR when `NVIDIA_API_KEY` is configured. Gemini and Groq automatically reconcile the OCR outputs with a deterministic parser; there is no manual OCR-verification screen, and the parser remains available if an external AI provider is busy. It groups repeated or similar wording and shows ranked questions, marks, a year-based area trend, and topic-share charts with tooltips. Reports can be saved to the Vault, downloaded as PDF, or opened for printing; the PDF includes metrics, charts, sources, and ranked groups. Gemini + Groq topic labeling and bounded importance ratings use `GEMINI_API_KEY` and `GROQ_API_KEY`; their ratings supplement a transparent score from observed paper counts, marks, and occurrences, **not a probability or prediction**. Scanned page images are sent to NVIDIA if its key is configured. Fictional sample files are in `examples/`.
- Light/dark switch with a saved preference and system-theme fallback. Its day/night artwork is from the [Figma community toggle reference](https://www.figma.com/design/qh34hm1jgO1HQ0AOZ4wD3P/Light-Dark-Mode-Toggle-Switch--Community-?node-id=7-81).
- Dashboard colours are mapped from the [Polaris TweakCN theme](https://tweakcn.com/themes/cmmr3radn000104l593xhbksh). The switch uses a reversible day-to-night wipe and respects reduced-motion settings.
- Polaris-colored animated SVG book/N mark, compact mobile mark, and favicon based on the supplied Nexora logo.
- Responsive navigation drawer, sample task completion, and a 25-minute focus timer.
- First-visit name prompt. The name is saved in browser storage and can be changed from Settings.

The overview metrics and study tasks are **sample data**. The display name, sample task completion, theme choice, saved study guides, and Vault files are stored in this browser. Open Nexora through `npm start` rather than `dist/index.html` to use the summarizer and pattern-analysis APIs. The caption retriever uses an unofficial YouTube interface, so changes to YouTube, restricted videos, disabled captions, or network limits can interrupt retrieval. This version requires internet access to YouTube and an AI provider. Notifications remain unconnected.

## Team ownership

| Gladson | Aishwarya | Muthulakshmi |
| --- | --- | --- |
| Prof Pattern Detector | Vault | FlashLoop |
| One-Shot Summarizer | SyllabusToSchedule | Focus Mode |
| AI Study Assistant | NoteToQuiz | Progress Analytics |

`dist/app.js` contains module definitions, navigation, and dashboard interactions. `dist/pattern.js` renders the pattern analysis. `server/pattern.js` extracts and analyzes question papers. `dist/styles.css` contains design tokens and responsive styles. `dist/index.html` initializes the theme before styles load.
