import type { AppInfo, Job, JobRequest, Settings, VideoEstimate } from './api';
import { fileName } from './tools';
import { downloadFile, fileBlob, forgetFile, inspectBrowserFiles, pickBrowserFiles, storeFile } from './browserFiles';
import { compressImage, encodeImage } from './browserImages';
import { archiveFiles, convertPdf, pdfRaster, type BrowserOutput } from './browserPdf';
import { audioCodecs, checkCancelled, isAudio, isImage, mediaMime, readBytes, withMedia } from './browserMedia';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

type Task = { job:Job; request:JobRequest; controller:AbortController };
const tasks: Task[] = [];
let draining = false;
const previewControllers = new Map<number,AbortController>();
let settings: Settings = { outputDir:'',concurrency:1,ffmpegPath:'',qpdfPath:'',pdfRendererPath:'' };
const stem = (path:string) => fileName(path).replace(/\.[^.]+$/,'');

async function probe(ffmpeg: FFmpeg, input: string) {
  const messages:string[] = []; const log = ({message}:{message:string}) => messages.push(message);
  ffmpeg.on('log',log);
  let status:number;
  try { status = await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration:stream=codec_type,width,height,r_frame_rate','-of','json',input,'-o','probe.json']); }
  finally { ffmpeg.off('log',log); }
  // Some core builds leave a nonzero exit sentinel despite writing valid JSON.
  // Validate the actual probe output rather than treating that sentinel as failure.
  let value;
  try { value = await ffmpeg.readFile('probe.json','utf8'); }
  catch { throw new Error(`This file could not be read by the browser media engine (${status}). ${messages.slice(-5).join(' ')}`); }
  return JSON.parse(String(value)) as {format?:{duration?:string};streams?:{codec_type:string;width?:number;height?:number;r_frame_rate?:string}[]};
}
function videoFilter(request: JobRequest, dimensions?: {width?:number;height?:number;r_frame_rate?:string}) {
  const filters: string[] = [];
  if (request.videoHeight) filters.push(`scale=-2:trunc(min(ih\\,${request.videoHeight})/2)*2`);
  else filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  const [a,b] = (dimensions?.r_frame_rate || '').split('/').map(Number);
  const sourceFps = a / b;
  if (request.videoFps && sourceFps > request.videoFps) filters.push(`fps=${request.videoFps}`);
  return filters.join(',');
}
async function convertMedia(request: JobRequest, signal?:AbortSignal, progress?:(n:number)=>void): Promise<BrowserOutput> {
  return withMedia(request.inputs,signal,progress,async (ffmpeg,[input],execute) => {
    const source = request.inputs[0]; const name = stem(source);
    let format = request.format || 'mp4'; let args: string[] = ['-i',input];
    if (request.kind === 'mp3' || request.kind === 'audio') {
      if (!audioCodecs[format]) throw new Error('Choose a supported audio format.');
      const metadata = await probe(ffmpeg,input);
      if (!metadata.streams?.some(stream => stream.codec_type === 'audio')) throw new Error('This file has no audio track.');
      if (request.kind === 'mp3' && !metadata.streams.some(stream => stream.codec_type === 'video')) throw new Error('Choose a video containing an audio track.');
      args.push('-map','0:a:0','-vn',...audioCodecs[format]);
      if (format === 'ogg') args.push('-q:a',String(request.bitrate >= 320 ? 7 : request.bitrate >= 192 ? 5 : 3));
      else if (!['wav','flac','aiff'].includes(format)) args.push('-b:a',`${request.bitrate}k`);
    } else if (request.kind === 'video') {
      const data = await probe(ffmpeg,input); const video = data.streams?.find(s => s.codec_type === 'video');
      if (!video) throw new Error('This file has no video track.');
      args.push('-map','0:v:0','-map','0:a:0?','-vf',videoFilter(request,video),'-c:v',format === 'webm' ? 'libvpx' : 'libx264','-threads','1','-crf',String(Math.round(45 - (request.videoQuality || 65) * .32)));
      args.push(...(format === 'webm' ? ['-b:v','0','-cpu-used','5','-c:a','libvorbis'] : ['-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac']));
    } else if (request.kind === 'gif') {
      format = 'gif'; args = ['-ss',String(request.start || 0),'-i',input];
      if (request.duration !== null) args.push('-t',String(request.duration));
      args.push('-filter_complex',`[0:v]fps=${request.fps},scale=min(${request.width}\\,iw):-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`,'-loop','0');
    } else if (request.kind === 'trim') {
      if (!(request.duration && request.duration > 0)) throw new Error('Choose an end time after the start.');
      const audio = isAudio(source); format = audio ? 'm4a' : 'mp4';
      args = ['-ss',String(request.start),'-i',input,'-t',String(request.duration),...(audio ? ['-vn','-c:a','aac'] : ['-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac'])];
    } else if (request.kind === 'frames') {
      format = format === 'jpg' ? 'jpg' : 'png';
      if (request.operation === 'interval') {
        const data = await probe(ffmpeg,input); const duration = Number(data.format?.duration || 0); const interval = request.interval || 5;
        if (!(interval >= .1) || Math.ceil((duration - request.start) / interval) > 1000) throw new Error('Export at most 1,000 frames per browser job. Increase the capture interval.');
        await execute(['-ss',String(request.start),'-i',input,'-vf',`fps=1/${interval}`,'-frames:v','1000',`frame-%05d.${format}`]);
        const results = [];
        for (const entry of await ffmpeg.listDir('/')) if (entry.name.startsWith('frame-')) results.push({name:entry.name,blob:new Blob([await readBytes(ffmpeg,entry.name)],{type:mediaMime(format)})});
        if (!results.length) throw new Error('No frames found at the selected timestamp.');
        return archiveFiles(results,`${name}-frames.zip`,signal);
      }
      args = ['-ss',String(request.start),'-i',input,'-frames:v','1'];
    } else if (request.kind === 'metadata') {
      format = source.split('.').pop()?.toLowerCase() || 'mp4';
      args.push('-map','0:v?','-map','0:a?','-map','0:s?','-c','copy','-map_metadata','-1','-map_chapters','-1');
    } else if (request.kind === 'compress') {
      const limit = (request.targetMb || 0) * 1_000_000;
      if (limit < 10_000) throw new Error('Choose a size limit of at least 0.01 MB.');
      const data = await probe(ffmpeg,input); const duration = Number(data.format?.duration || 0);
      if (!(duration > 0)) throw new Error('Cannot determine this recording’s duration.');
      const audio = isAudio(source); format = audio ? 'mp3' : 'mp4';
      const totalBitrate = Math.floor(limit * 8 * .9 / duration);
      const audioBitrate = audio ? Math.min(320000,totalBitrate) : Math.min(96000,Math.floor(totalBitrate*.2));
      if (audioBitrate < 16000 || !audio && totalBitrate-audioBitrate < 20000) throw new Error('The requested size is too small for this recording.');
      args.push(...(audio ? ['-vn','-c:a','libmp3lame','-b:a',String(audioBitrate)] : ['-map','0:v:0','-map','0:a:0?','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-b:v',String(totalBitrate-audioBitrate),'-c:a','aac','-b:a',String(audioBitrate)]));
      if (!audio) {
        await execute([...args,'-pass','1','-passlogfile','size-pass','-an','-f','null','-']);
        args.push('-pass','2','-passlogfile','size-pass');
      }
    } else throw new Error('This tool is not available in the browser.');
    const output = `result.${format}`;
    await execute([...args,output]);
    let bytes = await readBytes(ffmpeg,output);
    if (!bytes.length) throw new Error('The selected range produced no output.');
    if (request.kind === 'compress') {
      const limit = (request.targetMb || 0) * 1_000_000;
      // Short clips and container overhead can exceed a bitrate estimate.
      // Rebudget against measured bytes and verify every published output.
      for (let attempt=0; bytes.byteLength>limit && attempt<4; attempt++) {
        const factor = Math.min(.8,limit/bytes.byteLength*.85);
        for (const key of ['-b:v','-b:a']) {
          const index = args.indexOf(key);
          if (index>=0) args[index+1] = String(Math.max(key==='-b:a'?16000:20000,Math.floor(Number(args[index+1])*factor)));
        }
        if (!isAudio(source)) {
          const base = args.slice(0,args.indexOf('-pass'));
          await execute([...base,'-pass','1','-passlogfile','size-pass','-an','-f','null','-']);
        }
        await execute([...args,output]); bytes = await readBytes(ffmpeg,output);
      }
      if (bytes.byteLength>limit) throw new Error('The result exceeds the requested size. Try a larger limit. No oversized output was saved.');
    }
    return { name:`${name}${request.kind === 'metadata' ? '-clean' : request.kind === 'trim' ? '-clip' : request.kind === 'frames' ? '-frame' : '-converted'}.${format}`,blob:new Blob([bytes],{type:mediaMime(format)}) };
  });
}
async function convert(request: JobRequest, signal:AbortSignal, progress:(n:number)=>void): Promise<BrowserOutput> {
  const path = request.inputs[0];
  if (['pdf','pdf-pages','images-pdf','pdf-images'].includes(request.kind) || request.kind === 'metadata' && /\.pdf$/i.test(path)) return convertPdf(request,signal,progress);
  if (request.kind === 'image' || request.kind === 'image-edit' || request.kind === 'metadata' && isImage(path)) {
    const extension = path.split('.').pop()!.toLowerCase();
    const format = request.kind === 'metadata' ? extension === 'jpeg' ? 'jpg' : extension === 'tif' ? 'tiff' : extension : request.format || 'png';
    const result = await encodeImage(path,{...request,format},signal);
    return {name:`${stem(path)}${request.kind === 'metadata' ? '-clean' : '-converted'}.${format}`,blob:result.blob};
  }
  if (request.kind === 'compress' && isImage(path)) return {name:`${stem(path)}-compressed.jpg`,blob:await compressImage(path,(request.targetMb || 0)*1_000_000,signal)};
  return convertMedia(request,signal,progress);
}
async function drain() {
  if (draining) return; draining = true;
  try {
    for (;;) {
      const task = tasks.find(task => task.job.status === 'queued'); if (!task) break;
      task.job.status = 'running'; task.job.progress = 1;
      try {
        const result = await convert(task.request,task.controller.signal,n => { task.job.progress = n; });
        checkCancelled(task.controller.signal);
        task.job.output = storeFile(result.blob,result.name).path; task.job.outputIsDirectory = Boolean(result.archive);
        task.job.status = 'completed'; task.job.progress = 100;
      } catch (e) { task.job.status = task.controller.signal.aborted ? 'cancelled' : 'failed'; task.job.error = task.controller.signal.aborted ? null : e instanceof Error ? e.message : String(e); }
    }
  } finally { draining = false; }
}
async function preview(request: JobRequest, revision:number, kind:'visual'|'size') {
  const controller = new AbortController(); const key = kind === 'visual' ? revision : -revision;
  previewControllers.get(key)?.abort(); previewControllers.set(key,controller);
  try {
    if (kind === 'size') {
      const results = [];
      for (const path of request.inputs) { const result = await encodeImage(path,request,controller.signal); results.push({path,size:result.blob.size,width:result.width,height:result.height,sourceWidth:result.sourceWidth,sourceHeight:result.sourceHeight}); }
      return results;
    }
    const path = request.inputs[0]; let blob:Blob;
    if (isImage(path)) {
      const result = await encodeImage(path,{...request,format:'png'},controller.signal); blob = result.blob;
    } else if (/\.pdf$/i.test(path)) blob = (await pdfRaster(path,request.pages || '',96,'png',controller.signal,undefined,true))[0].blob;
    else {
      const result = await convertMedia({...request,kind:'frames',operation:'single',format:'png',inputs:[path]},controller.signal); blob = result.blob;
    }
    checkCancelled(controller.signal);
    return {bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),mime:blob.type};
  } finally { if (previewControllers.get(key) === controller) previewControllers.delete(key); }
}
export async function browserInvoke(command:string,args:Record<string,unknown>): Promise<unknown> {
  switch (command) {
    case 'app_info': return { settings,cpuCount:navigator.hardwareConcurrency || 1,engines:['FFmpeg','qpdf','PDF renderer'].map(name => ({name,path:'browser',version:'Runs in your browser'})) } satisfies AppInfo;
    case 'pick_files': return pickBrowserFiles(args.extensions as string[]);
    case 'inspect_files': return inspectBrowserFiles(args.paths as string[]);
    case 'pick_folder': return null;
    case 'open_file': case 'reveal_file': downloadFile(args.path as string); return;
    case 'save_settings': settings = {...args.settings as Settings,concurrency:1,outputDir:''}; return browserInvoke('app_info',{});
    case 'list_jobs': return tasks.map(({job}) => ({...job})).reverse();
    case 'enqueue': {
      const request = args.request as JobRequest;
      if (request.kind === 'youtube') throw new Error('YouTube downloading is unavailable on the standalone website. Convert a video file instead.');
      if (!request.inputs.length) throw new Error('Add at least one source file.');
      if (request.kind === 'pdf' && request.inputs.length < 2) throw new Error('Add at least two PDFs to merge.');
      request.inputs.forEach(fileBlob);
      const groups = ['pdf','images-pdf'].includes(request.kind) ? [request.inputs] : request.inputs.map(input => [input]);
      const jobs:Job[] = groups.map(inputs => {
        const job:Job = {id:crypto.randomUUID(),kind:request.kind,label:inputs.length > 1 ? request.outputName : fileName(inputs[0]),status:'queued',progress:0,output:null,outputIsDirectory:false,error:null,created:Date.now()};
        tasks.push({job,request:{...request,inputs:[...inputs]},controller:new AbortController()}); return {...job};
      });
      setTimeout(() => void drain(),0); return jobs;
    }
    case 'cancel_job': { const task = tasks.find(task => task.job.id === args.id); if (task && ['queued','running'].includes(task.job.status)) { task.job.status = 'cancelled'; task.controller.abort(); } return; }
    case 'clear_finished': for (let i = tasks.length-1; i >= 0; i--) if (!['queued','running'].includes(tasks[i].job.status)) { const output = tasks[i].job.output; if (output) forgetFile(output); tasks.splice(i,1); } return;
    case 'preview_images': return preview(args.request as JobRequest,args.revision as number,'size');
    case 'visual_preview': return preview(args.request as JobRequest,args.revision as number,'visual');
    case 'cancel_image_preview': case 'cancel_visual_preview': { const key = (args.revision as number) * (command === 'cancel_image_preview' ? -1 : 1); previewControllers.get(key)?.abort(); return; }
    case 'estimate_videos': {
      const request = args.request as JobRequest; const estimates:VideoEstimate[] = [];
      for (const path of request.inputs) {
        const estimate = await withMedia([path],undefined,undefined,async (ffmpeg,[input]) => {
          const data = await probe(ffmpeg,input); const video = data.streams?.find(s=>s.codec_type==='video');
          if (!video?.width || !video.height) throw new Error('No video stream found.');
          const scale = request.videoHeight ? Math.min(1,request.videoHeight/video.height) : 1;
          const width = Math.max(2,Math.floor(video.width*scale/2)*2),height = Math.max(2,Math.floor(video.height*scale/2)*2);
          const [a,b] = (video.r_frame_rate || '30/1').split('/').map(Number); const fps = Math.min(a/b || 30,request.videoFps || Infinity);
          const bitrate = Math.round(width*height*fps*(.02+(request.videoQuality || 65)/100*.18));
          return {path,width,height,fps,bitrate,size:Math.round(Number(data.format?.duration || 0)*(bitrate+128000)/8)};
        }); estimates.push(estimate);
      }
      return estimates;
    }
    default: throw new Error('This action is only available in the Windows desktop app.');
  }
}
