import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { jsPDF } from 'jspdf';
import { extractPdfWithOcr, pdfJsResourceOptions, reconcileOcr, nvidiaOcr, llamaVisionOcr } from './pattern-ocr.js';

test('PDF.js receives local decoder and font directories for scanned PDFs',async () => {
  const options = pdfJsResourceOptions();
  assert.match(options.wasmUrl,/pdfjs-dist\/wasm\/$/);
  assert.match(options.standardFontDataUrl,/pdfjs-dist\/standard_fonts\/$/);
  const { access } = await import('node:fs/promises');
  await access(`${options.wasmUrl}jbig2.wasm`);
});

test('OCR agreement requires matching numbers and sufficient confidence', () => {
  assert.equal(reconcileOcr({text:'Q1. Explain inheritance [8]',confidence:90},{text:'Q1. Explain inheritance [8]',confidence:.9}).status,'agree');
  assert.equal(reconcileOcr({text:'Q1. Explain inheritance [8]',confidence:90},{text:'Q1. Explain inheritance [3]',confidence:.9}).status,'review');
});

test('three-engine OCR uses the numeric majority when one engine misreads 8 as 3', () => {
  const result=reconcileOcr(
    {text:'Q1. Explain inheritance [8]',confidence:88},
    {text:'Q1. Explain inheritance [3]',confidence:.96},
    {text:'Q1. Explain inheritance [8]',confidence:.8}
  );
  assert.match(result.text,/\[8\]/);
  assert.equal(result.numberConsensus,true);
});

test('NVIDIA OCR uses the OCR endpoint and parses text detections',async () => {
  let called = false;
  const fetchImpl = async (url,options) => {
    called = true;
    assert.match(url,/nemotron-ocr-v2$/);
    assert.equal(JSON.parse(options.body).merge_levels[0],'paragraph');
    return {ok:true,json:async () => ({data:[{text_detections:[{text_prediction:{text:'Q1. Define arrays [5]',confidence:.95}}]}]})};
  };
  const result = await nvidiaOcr(Buffer.from('png'),'test-key',fetchImpl);
  assert.equal(called,true);
  assert.match(result.text,/Define arrays/);
});

test('Llama Vision OCR uses NVIDIA chat completions without exposing the key',async () => {
  const result=await llamaVisionOcr(Buffer.from('png'),'test-llama-key',async (url,options) => {
    assert.match(url,/integrate\.api\.nvidia\.com\/v1\/chat\/completions$/);
    assert.equal(options.headers.Authorization,'Bearer test-llama-key');
    const body=JSON.parse(options.body);
    assert.equal(body.model,'meta/llama-3.2-11b-vision-instruct');
    assert.match(body.messages[0].content[0].image_url.url,/^data:image\/png;base64,/);
    return {ok:true,json:async()=>({choices:[{message:{content:'Q1. Define arrays [8]'}}]})};
  });
  assert.match(result.text,/\[8\]/);
});

test('scanned PDF uses local Tesseract even if NVIDIA is unavailable',async () => {
  const canvas = createCanvas(1400,500);
  const context = canvas.getContext('2d');
  context.fillStyle='white'; context.fillRect(0,0,1400,500);
  context.fillStyle='black'; context.font='bold 42px Arial';
  context.fillText('Q1. Explain inheritance in Java [8]',45,115);
  const document = new jsPDF({unit:'pt',format:[700,250]});
  document.addImage(canvas.toBuffer('image/png'),'PNG',0,0,700,250);
  const pages = await extractPdfWithOcr(Buffer.from(document.output('arraybuffer')),{fetchImpl:async () => ({ok:false,status:503}),nvidiaKey:'test-key',llamaKey:'test-llama-key'});
  assert.equal(pages[0].source,'ocr');
  assert.match(pages[0].tesseract.text,/inheritance/i);
  assert.equal(pages[0].status,'review');
});
