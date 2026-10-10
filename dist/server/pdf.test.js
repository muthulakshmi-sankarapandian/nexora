import test from 'node:test';
import assert from 'node:assert/strict';
import {jsPDF} from 'jspdf';
import '../dist/pdf.js';

const note = {
  title:'Inside your computer',
  overview:'This guide explains how a computer receives input, processes information, and produces output.',
  createdAt:'2026-09-26T08:00:00.000Z',
  sourceUrl:'https://www.youtube.com/watch?v=AkFi90lZmXA',
  sections:Array.from({length:9}, (_, index) => ({
    timestamp:`0${index}:00`, heading:`Part ${index + 1}: Hardware and information flow`,
    points:Array.from({length:5}, () => 'The input subsystem receives information and passes it to the processor, which follows instructions stored in memory. This process is explained in the lecture with a practical example.')
  })),
  takeaways:['Input, processing, memory, and output work together.', 'Programs tell the processor what to do.']
};

test('creates a readable, multipage PDF with title and source', () => {
  const doc = globalThis.NexoraPdf.createStudyGuidePdf(note, jsPDF);
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(doc.getNumberOfPages() > 1);
  assert.ok(doc.internal.pages.slice(1).every(page => page.filter(command => command.includes('NEXORA')).length >= 2));
  assert.equal(globalThis.NexoraPdf.filename(note), 'Inside-your-computer.pdf');
});

test('creates a pattern-analysis PDF containing charts and ranked questions',() => {
  const groups=Array.from({length:18},(_,index)=>({id:`q-${index+1}`,question:`Explain operating system concept ${index+1} and give a suitable example.`,topic:index%2?'Scheduling':'Memory Management',count:4-index%3,paperCount:3-index%2,totalMarks:12-index%4,marksKnown:2,occurrences:[{year:'2023',paper:'Paper A',page:1,marks:5},{year:'2024',paper:'Paper B',page:2,marks:7}]}));
  const report={createdAt:'2026-09-26T08:00:00.000Z',papers:[{filename:'Paper A.pdf',year:'2023',questions:groups},{filename:'Paper B.pdf',year:'2024',questions:groups}],analysis:{paperCount:2,totalQuestions:72,repeatedGroups:18,marksKnown:36,groups},topics:[{topic:'Scheduling',count:36,marks:80},{topic:'Memory Management',count:36,marks:72}],trend:[{year:'2023',value:75},{year:'2024',value:82}]};
  const doc=globalThis.NexoraPdf.createPatternReportPdf(report,jsPDF);
  const bytes=new Uint8Array(doc.output('arraybuffer'));
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
  assert.ok(doc.getNumberOfPages()>1);
  assert.match(globalThis.NexoraPdf.patternFilename(report),/^Nexora-Prof-Pattern-2026-09-26\.pdf$/);
});
