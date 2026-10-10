import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const { langPath } = require('@tesseract.js-data/eng');
const NVIDIA_OCR_URL = 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2';
const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const LLAMA_VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';

export function pdfJsResourceOptions() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const directory = relative => `${path.resolve(projectRoot,relative).replaceAll('\\','/')}/`;
  return {wasmUrl:directory('node_modules/pdfjs-dist/wasm'),standardFontDataUrl:directory('node_modules/pdfjs-dist/standard_fonts')};
}

export function reconcileOcr(tesseract, nvidia, llama = null) {
  const local = String(tesseract?.text || '').trim();
  const remote = String(nvidia?.text || '').trim();
  const vision = String(llama?.text || '').trim();
  const normalize = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const left = normalize(local);
  const right = normalize(remote);
  const overlap = left.filter(word => right.includes(word)).length;
  const agreement = left.length && right.length ? Math.round(100 * (2 * overlap) / (left.length + right.length)) : 0;
  const numbers = text => (text.match(/\d+/g) || []).join(',');
  const candidates = [
    {name:'tesseract',text:local,confidence:Number(tesseract?.confidence || 0)},
    {name:'nvidia',text:remote,confidence:Number(nvidia?.confidence || 0) * 100},
    {name:'llama',text:vision,confidence:Number(llama?.confidence || 0) * 100}
  ].filter(candidate => candidate.text);
  const signatures = new Map();
  candidates.forEach(candidate => {
    const signature=numbers(candidate.text);
    if (!signature) return;
    const group=signatures.get(signature) || [];
    group.push(candidate); signatures.set(signature,group);
  });
  const consensus=[...signatures.values()].sort((a,b)=>b.length-a.length || Math.max(...b.map(item=>item.confidence))-Math.max(...a.map(item=>item.confidence)))[0] || [];
  const pool=consensus.length >= 2 ? consensus : candidates;
  const selected=pool.sort((a,b)=>b.confidence-a.confidence)[0]?.text || '';
  const numbersAgree=consensus.length >= 2;
  const verified=numbersAgree && (agreement >= 75 || Boolean(vision));
  return { text:selected,agreement,status:verified?'agree':'review',tesseract:{text:local,confidence:tesseract?.confidence ?? null},nvidia:{text:remote,confidence:nvidia?.confidence ?? null},llama:{text:vision,confidence:llama?.confidence ?? null},numberConsensus:numbersAgree };
}

export async function nvidiaOcr(png, key, fetchImpl = fetch) {
  if (!key || key === 'PASTE_YOUR_KEY_HERE') throw new Error('NVIDIA OCR key is not configured.');
  const response = await fetchImpl(NVIDIA_OCR_URL, {
    method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({input:[{type:'image_url',url:`data:image/png;base64,${png.toString('base64')}`}],merge_levels:['paragraph']}),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`NVIDIA OCR returned HTTP ${response.status}.`);
  const data = await response.json();
  const detections = data?.data?.[0]?.text_detections || [];
  const valid = detections.filter(item => item?.text_prediction?.text);
  return {text:valid.map(item => item.text_prediction.text).join('\n'),confidence:valid.length ? valid.reduce((sum,item) => sum + (Number(item.text_prediction.confidence) || 0),0)/valid.length : 0};
}

export async function llamaVisionOcr(png,key,fetchImpl=fetch) {
  if (!key || key === 'PASTE_YOUR_KEY_HERE') throw new Error('Llama OCR key is not configured.');
  const response=await fetchImpl(NVIDIA_CHAT_URL,{
    method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({
      model:LLAMA_VISION_MODEL,
      messages:[{role:'user',content:[
        {type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}},
        {type:'text',text:'Transcribe every visible line of this question-paper page exactly. Preserve question numbers, punctuation, options, and printed marks. Pay special attention to distinguishing 3, 5, 8, and 10. Do not answer or explain the questions. Return only the transcription.'}
      ]}],
      max_tokens:4096,temperature:0.1,top_p:0.9,stream:false
    }),
    signal:AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`Llama OCR returned HTTP ${response.status}.`);
  const data=await response.json();
  const text=String(data?.choices?.[0]?.message?.content || '').replace(/^```(?:text)?\s*|\s*```$/g,'').trim();
  if (!text) throw new Error('Llama OCR returned no transcription.');
  return {text,confidence:.8};
}

export async function extractPdfWithOcr(bytes, {nvidiaKey,llamaKey,fetchImpl = fetch} = {}) {
  const task = getDocument({data:new Uint8Array(bytes),useSystemFonts:true,...pdfJsResourceOptions()});
  const document = await task.promise;
  const pages = [];
  let worker;
  try {
    if (document.numPages > 25) throw new Error('Use a question paper with at most 25 pages.');
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const native = content.items.filter(item => 'str' in item).map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trim();
      if (native.replace(/\s/g,'').length >= 15) {
        pages.push({number,text:native,source:'selectable'});
        page.cleanup();
        continue;
      }
      const viewport = page.getViewport({scale:2});
      const canvas = createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      const png = canvas.toBuffer('image/png');
      if (!worker) worker = await createWorker('eng',1,{langPath,cacheMethod:'none'});
      const [localResult, remoteResult, llamaResult] = await Promise.allSettled([
        worker.recognize(png).then(result => ({text:result.data.text,confidence:result.data.confidence})),
        nvidiaOcr(png,nvidiaKey,fetchImpl),
        llamaVisionOcr(png,llamaKey,fetchImpl)
      ]);
      const local = localResult.status === 'fulfilled' ? localResult.value : null;
      const remote = remoteResult.status === 'fulfilled' ? remoteResult.value : null;
      const llama = llamaResult.status === 'fulfilled' ? llamaResult.value : null;
      const comparison = reconcileOcr(local,remote,llama);
      pages.push({number,...comparison,source:'ocr',warnings:[localResult.status === 'rejected' ? 'Local Tesseract could not read this page.' : null,remoteResult.status === 'rejected' ? `NVIDIA OCR unavailable: ${remoteResult.reason?.message || 'request failed'}` : null,llamaResult.status === 'rejected' ? `Llama OCR unavailable: ${llamaResult.reason?.message || 'request failed'}` : null].filter(Boolean)});
      page.cleanup();
    }
  } finally {
    if (worker) await worker.terminate();
    await task.destroy();
  }
  return pages;
}
