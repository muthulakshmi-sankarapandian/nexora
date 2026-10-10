import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStudyAssistant, cleanChatMessages } from './study-chat.js'

test('study chat falls back from Gemini to Groq',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(String(url).includes('googleapis')) return {ok:false,status:503,json:async()=>({})};
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:'A concise answer.'}}]})};
  };
  const result=await chatStudyAssistant([{role:'user',content:'Explain polymorphism.'}],{geminiKey:'x',groqKey:'y',fetchImpl});
  assert.equal(result.provider,'Groq');
  assert.equal(result.reply,'A concise answer.');
  assert.ok(calls.some(url=>url.includes('googleapis')));
  assert.ok(calls.some(url=>url.includes('groq')));
});

test('chat input is bounded and must end with a user question',()=>{
  assert.equal(cleanChatMessages(Array.from({length:20},(_,index)=>({role:'user',content:`Question ${index}`}))).length,12);
  assert.throws(()=>cleanChatMessages([{role:'assistant',content:'Hello'}]),/study question/);
});
