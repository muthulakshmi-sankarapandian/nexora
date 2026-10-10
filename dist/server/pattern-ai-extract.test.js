import test from 'node:test';
import assert from 'node:assert/strict';
import { extractQuestionsWithAi, reconcileQuestionExtractions } from './pattern-ai-extract.js';

test('merges two AI readings and deterministic parser without duplicate questions',() => {
  const result=reconcileQuestionExtractions(
    [{number:1,text:'Explain process scheduling in an operating system.',marks:5,page:1}],
    [{number:1,text:'Explain process scheduling in the operating system.',marks:5,page:1}],
    [{number:2,text:'What is a semaphore in operating systems?',marks:null,page:1}]
  );
  assert.equal(result.length,2);
  assert.equal(result[0].confidence,'cross-checked');
  assert.equal(result[1].confidence,'single-source');
});

test('uses Gemini and Groq to cross-check OCR text',async () => {
  const payload={questions:[{number:1,text:'Explain deadlock prevention methods.',marks:8,page:1}]};
  const fetchImpl=async url => url.includes('googleapis')
    ? {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(payload)}]}}]})}
    : {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(payload)}}]})};
  const result=await extractQuestionsWithAi([{number:1,text:'1 Explain deadlock prevention methods',tesseract:{text:'1. Explain deadlock prevention methods'},nvidia:{text:'1. Explain deadlock prevention methods'}}],{geminiKey:'x',groqKey:'y',fetchImpl});
  assert.deepEqual(result.providers,['Gemini','Groq']);
  assert.equal(result.questions[0].confidence,'cross-checked');
});

test('uses numeric consensus when one OCR model mistakes 8 marks for 3',() => {
  const result=reconcileQuestionExtractions(
    [{number:1,text:'Explain resource allocation methods.',marks:3,page:1}],
    [{number:1,text:'Explain resource allocation methods.',marks:8,page:1}],
    [{number:1,text:'Explain resource allocation methods.',marks:8,page:1}]
  );
  assert.equal(result[0].marks,8);
});
