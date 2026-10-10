const LATEX_PATTERN = /\${1,2}|\\(?:frac|sqrt|sum|prod|int|lim|begin|end|text|mathrm|mathbf|mathit|left|right|cdot|times|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega)\b|\\[A-Za-z]+\s*[\[{]|\\[()[\]{}]|[\^_]\s*\{/i;

function textHasLatex(text) {
  // Prices are ordinary study-note prose, not math delimiters. Removing complete
  // currency tokens still leaves the trailing `$` in expressions such as `$2x$`.
  const withoutCurrency = text.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, '');
  return LATEX_PATTERN.test(withoutCurrency);
}

export function hasLatex(value) {
  if (typeof value === 'string') return textHasLatex(value);
  if (Array.isArray(value)) return value.some(hasLatex);
  if (value && typeof value === 'object') return Object.values(value).some(hasLatex);
  return false;
}

export function cleanCaptions(raw) {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
}

export function validateNotes(notes) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) throw new Error('The note response was not valid.');
  if (typeof notes.title !== 'string' || !notes.title.trim()) throw new Error('The notes need a title.');
  if (typeof notes.overview !== 'string' || !notes.overview.trim()) throw new Error('The notes need an overview.');
  if (!Array.isArray(notes.sections) || !notes.sections.length) throw new Error('The notes need at least one section.');
  for (const section of notes.sections) {
    if (typeof section.heading !== 'string' || !section.heading.trim() ||
        typeof section.timestamp !== 'string' ||
        !Array.isArray(section.points) || !section.points.length ||
        section.points.some(point => typeof point !== 'string' || !point.trim())) {
      throw new Error('One of the note sections was incomplete.');
    }
  }
  if (!Array.isArray(notes.takeaways) || notes.takeaways.some(item => typeof item !== 'string')) {
    throw new Error('The takeaways were not valid.');
  }
  if (hasLatex(notes)) throw new Error('The generated notes contained LaTeX notation. Please generate them again.');
  return notes;
}
