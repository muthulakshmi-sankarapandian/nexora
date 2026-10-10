import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanCaptions, hasLatex, validateNotes} from './notes.js';

const sample = {title:'Design patterns',overview:'A clear overview.',sections:[{timestamp:'01:20',heading:'Factory pattern',points:['Create objects through a shared interface.']}],takeaways:['Choose a pattern for a specific design problem.']};

test('caption normalization preserves timestamps', () => {
  assert.equal(cleanCaptions('\uFEFF00:01:20\r\nFactory pattern\r\n'), '00:01:20\nFactory pattern');
});
test('valid notes pass without LaTeX', () => {
  assert.equal(validateNotes(sample), sample);
});
test('LaTeX is blocked anywhere in printable notes', () => {
  assert.equal(hasLatex({...sample, sections:[{...sample.sections[0],points:['Use \\frac{a}{b}.']}]}), true);
  assert.throws(() => validateNotes({...sample, overview:'Equation: $a+b$'}), /LaTeX/);
});
test('currency and Windows paths are not mistaken for LaTeX', () => {
  const operatingSystems = {...sample,overview:'Windows may use C:\\Windows, while older software could cost $129 and updates cost $5.'};
  assert.equal(hasLatex(operatingSystems), false);
  assert.equal(validateNotes(operatingSystems), operatingSystems);
});
test('incomplete sections are rejected', () => {
  assert.throws(() => validateNotes({...sample,sections:[{timestamp:'',heading:'',points:[]}]}), /incomplete/);
});
