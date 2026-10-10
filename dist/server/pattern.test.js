import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { analyzeQuestionPapers, extractPdfPages, inferExamYear, parseQuestionPaper } from './pattern.js';

test('extracts numbered questions and marks from plain text', () => {
  const paper = parseQuestionPaper([{number:1,text:'Advanced Programming Practices\n1. Explain design patterns with an example. [8]\n2. Describe exception handling in Java. (5 marks)'}], {filename:'2024.txt',year:'2024'});
  assert.equal(paper.questions.length, 2);
  assert.deepEqual(paper.questions.map(question => question.marks), [8, 5]);
  assert.equal(paper.questions[0].page, 1);
});

test('counts repeated wording across distinct papers without inventing marks', () => {
  const first = parseQuestionPaper([{number:1,text:'1. Explain design patterns with an example. [8]\n2. Describe exception handling in Java.'}], {filename:'2023.txt',year:'2023'});
  const second = parseQuestionPaper([{number:1,text:'Q1. Describe design patterns with an example. [10]\nQ2. Explain file handling in Java. [5]'}], {filename:'2024.txt',year:'2024'});
  const result = analyzeQuestionPapers([first, second]);
  assert.equal(result.paperCount, 2);
  assert.equal(result.totalQuestions, 4);
  assert.equal(result.repeatedGroups, 1);
  assert.equal(result.groups[0].paperCount, 2);
  assert.equal(result.groups[0].totalMarks, 18);
  assert.equal(result.marksKnown, 3);
});

test('extracts text from a generated PDF question paper', async () => {
  const pdf = new jsPDF();
  pdf.text('1. Explain polymorphism in programming. [8]', 12, 20);
  const pages = await extractPdfPages(Buffer.from(pdf.output('arraybuffer')));
  const paper = parseQuestionPaper(pages, {filename:'questions.pdf'});
  assert.equal(paper.questions.length, 1);
  assert.match(paper.questions[0].text, /polymorphism/);
  assert.equal(paper.questions[0].marks, 8);
});

test('infers four-digit exam years from dated filenames', () => {
  assert.equal(inferExamYear('21CSC202J 25.02.2026 FN.pdf'),'2026');
  assert.equal(inferExamYear('21CSC202J 25.01.2025.pdf'),'2025');
  assert.equal(inferExamYear('question-bank.pdf'),'');
});
