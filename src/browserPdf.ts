import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { zipSync } from 'fflate';
import type { JobRequest } from './api';
import { fileBlob } from './browserFiles';
import { canvasBlob, canvasFor, imageCanvas } from './browserImages';
import { checkCancelled } from './browserMedia';

pdfjs.GlobalWorkerOptions.workerSrc = workerURL;
export type BrowserOutput = { name: string; blob: Blob; archive?: boolean };
export function selectedPages(selection: string, count: number, allowEmpty = true): number[] {
  if (!selection.trim()) { if (!allowEmpty) throw new Error('Choose at least one page.'); return Array.from({ length:count },(_,i) => i); }
  const result = new Set<number>();
  for (const part of selection.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error('Use page numbers such as 1, 3-5.');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > count) throw new Error(`Page numbers must be between 1 and ${count}.`);
    for (let page = start; page <= end; page++) result.add(page - 1);
  }
  return [...result];
}
export async function pdfRaster(path: string, selection: string, dpi: number, format: string, signal?: AbortSignal, progress?: (n:number) => void, preview = false): Promise<{ name: string; blob: Blob }[]> {
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  const task = pdfjs.getDocument({ data:new Uint8Array(await fileBlob(path).arrayBuffer()), cMapUrl:`${base}cmaps/`, cMapPacked:true, standardFontDataUrl:`${base}standard_fonts/`, wasmUrl:`${base}wasm/`, iccUrl:`${base}iccs/` });
  const abort = () => { void task.destroy(); }; signal?.addEventListener('abort',abort,{once:true});
  try {
    const document = await task.promise;
    const pages = selectedPages(selection,document.numPages);
    if (!preview && pages.length > 200) throw new Error('Export at most 200 PDF pages per browser job.');
    const result = [];
    for (const [index, number] of (preview ? pages.slice(0,1) : pages).entries()) {
      checkCancelled(signal);
      const page = await document.getPage(number + 1); const viewport = page.getViewport({ scale:dpi / 72 });
      const canvas = canvasFor(viewport.width,viewport.height);
      await page.render({ canvas, viewport, background:'#ffffff' }).promise;
      result.push({ name:`page-${number + 1}.${format}`, blob:await canvasBlob(canvas,format === 'jpg' ? 'image/jpeg' : 'image/png') });
      progress?.((index + 1) / pages.length * 95);
    }
    return result;
  } finally { signal?.removeEventListener('abort',abort); await task.destroy(); }
}
export async function archiveFiles(files: {name:string;blob:Blob}[], name: string, signal?: AbortSignal): Promise<BrowserOutput> {
  checkCancelled(signal);
  const entries: Record<string,Uint8Array> = {};
  let size = 0;
  for (const file of files) {
    size += file.blob.size;
    if (size > 512 * 1024 * 1024) throw new Error('This export is too large for browser memory. Export fewer pages or frames.');
    entries[file.name] = new Uint8Array(await file.blob.arrayBuffer()); checkCancelled(signal);
  }
  return { name, blob:new Blob([zipSync(entries,{level:0})],{type:'application/zip'}), archive:true };
}
export async function convertPdf(request: JobRequest, signal?: AbortSignal, progress?: (n:number) => void): Promise<BrowserOutput> {
  const stem = (request.outputName || 'document').replace(/[\\/:*?"<>|]/g,'_').replace(/\.pdf$/i,'').slice(0,100);
  if (request.kind === 'images-pdf') {
    const output = await PDFDocument.create();
    for (const [index,path] of request.inputs.entries()) {
      checkCancelled(signal);
      const { canvas } = await imageCanvas(path,{format:'jpg'},signal);
      const image = await output.embedJpg(await (await canvasBlob(canvas,'image/jpeg')).arrayBuffer());
      const scale = Math.min(595.28 / image.width,841.89 / image.height);
      const page = output.addPage([image.width * scale,image.height * scale]);
      page.drawImage(image,{x:0,y:0,width:page.getWidth(),height:page.getHeight()}); progress?.((index+1)/request.inputs.length*95);
    }
    return { name:`${stem}.pdf`,blob:new Blob([new Uint8Array(await output.save())],{type:'application/pdf'}) };
  }
  if (request.kind === 'pdf-images') {
    const pages = await pdfRaster(request.inputs[0],request.pages || '',request.dpi || 150,request.format || 'png',signal,progress);
    return archiveFiles(pages,'pdf-images.zip',signal);
  }
  const sources = [];
  for (const path of request.inputs) { checkCancelled(signal); sources.push(await PDFDocument.load(await fileBlob(path).arrayBuffer(),{updateMetadata:false})); }
  if (request.kind === 'metadata') {
    const document = sources[0]; document.catalog.delete(PDFName.of('Metadata')); document.context.trailerInfo.Info = undefined;
    return {name:'clean.pdf',blob:new Blob([new Uint8Array(await document.save())],{type:'application/pdf'})};
  }
  const output = await PDFDocument.create();
  for (const [index,source] of sources.entries()) {
    let pages = source.getPageIndices();
    if (request.kind === 'pdf-pages') {
      const selection = selectedPages(request.pages || '',source.getPageCount(),request.operation === 'split');
      pages = request.operation === 'remove' ? pages.filter(page => !selection.includes(page)) : selection;
      if (!pages.length) throw new Error('The result must contain at least one page.');
      if (request.operation === 'split') {
        const results = [];
        for (const [i,page] of pages.entries()) {
          checkCancelled(signal); const single = await PDFDocument.create(); const [copied] = await single.copyPages(source,[page]); single.addPage(copied);
          results.push({name:`page-${page+1}.pdf`,blob:new Blob([new Uint8Array(await single.save())],{type:'application/pdf'})}); progress?.((i+1)/pages.length*95);
        }
        return archiveFiles(results,'pdf-pages.zip',signal);
      }
    }
    const copied = await output.copyPages(source,pages); copied.forEach(page => output.addPage(page)); progress?.((index+1)/sources.length*95);
  }
  checkCancelled(signal);
  return {name:`${stem}.pdf`,blob:new Blob([new Uint8Array(await output.save())],{type:'application/pdf'})};
}
