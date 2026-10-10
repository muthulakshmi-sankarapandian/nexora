import assert from 'node:assert/strict'
import test from 'node:test'
import { moderateNickname, normalizeNickname } from './nickname-moderation.js'

const reply = decision => ({ok:true,status:200,json:async()=>decision})
const providerReply = (url,allowed=true) => String(url).includes('googleapis')
  ? reply({candidates:[{content:{parts:[{text:JSON.stringify({allowed,category:allowed?'none':'profanity',reason:allowed?'Safe nickname':'Offensive term'})}]}}]})
  : reply({choices:[{message:{content:JSON.stringify({allowed,category:allowed?'none':'profanity',reason:allowed?'Safe nickname':'Offensive term'})}}]})

test('nickname moderation cross-checks Gemini and Groq', async () => {
  const result = await moderateNickname('  Nova  ',{geminiKey:'x',groqKey:'y',fetchImpl:async url=>providerReply(url,true)})
  assert.equal(result.nickname,'Nova')
  assert.equal(result.allowed,true)
  assert.equal(result.crossChecked,true)
  assert.deepEqual(result.providers,['Gemini','Groq'])
})

test('one provider rejection blocks the nickname', async () => {
  const result = await moderateNickname('Example',{geminiKey:'x',groqKey:'y',fetchImpl:async url=>providerReply(url,!String(url).includes('groq'))})
  assert.equal(result.allowed,false)
  assert.equal(result.category,'profanity')
})

test('nickname input has strict length and character limits', () => {
  assert.equal(normalizeNickname('Study Buddy'),'Study Buddy')
  assert.throws(()=>normalizeNickname('x'),/between 2 and 24/)
  assert.throws(()=>normalizeNickname('name<script>'),/letters, numbers/)
})
