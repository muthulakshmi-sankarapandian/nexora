import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTopics } from './pattern-topics.js';

test('Gemini and Groq topic labels are cross-checked without inventing scores',async () => {
  const fetchImpl = async url => {
    if (url.includes('generativelanguage')) return {ok:true,json:async () => ({candidates:[{content:{parts:[{text:JSON.stringify({topics:[{id:'q-1',topic:'Inheritance',importance:4,reason:'Appears in multiple papers.'}]})}]}}]})};
    return {ok:true,json:async () => ({choices:[{message:{content:JSON.stringify({topics:[{id:'q-1',topic:'Object Oriented Inheritance',importance:5,reason:'Carries marks.'}]})}}]})};
  };
  const result = await analyzeTopics([{id:'q-1',question:'Explain inheritance in Java.',topic:'Explain Inheritance Java'}],{geminiKey:'x',groqKey:'y',fetchImpl});
  assert.deepEqual(result.providers,['Gemini','Groq']);
  assert.equal(result.topics[0].topic,'Inheritance');
  assert.equal(result.topics[0].alternate,'Object Oriented Inheritance');
  assert.equal(result.topics[0].aiAgreement,false);
  assert.equal(result.topics[0].aiImportance,4.5);
  assert.equal(result.topics[0].importanceDisagreement,1);
});

test('topic labeling degrades to one provider with warning',async () => {
  const fetchImpl = async url => url.includes('generativelanguage') ? {ok:false,status:429} : {ok:true,json:async () => ({choices:[{message:{content:JSON.stringify({topics:[{id:'q-1',topic:'Arrays'}]})}}]})};
  const result = await analyzeTopics([{id:'q-1',question:'Define arrays.',topic:'Define Arrays'}],{geminiKey:'x',groqKey:'y',fetchImpl});
  assert.deepEqual(result.providers,['Groq']);
  assert.equal(result.topics[0].topic,'Arrays');
  assert.equal(result.warnings.length,1);
});
