import { useState } from 'react';
import { Folder, LoaderCircle } from 'lucide-react';
import { api, desktop, nativeDesktop, type AppInfo, type Job } from './api';
import { requestFor } from './ToolOptions';
import { defaultPreferences, useStored } from './preferences';

const audio = ['mp3', 'm4a', 'ogg', 'wav', 'flac'];
const video = ['mp4', 'mkv', 'webm', 'mov', 'gif'];
export default function YouTubePage({ info, outputDir, chooseFolder, onJobs, toast }: { info: AppInfo | null; outputDir: string; chooseFolder: () => void; onJobs: (jobs: Job[]) => void; toast: (text: string, error?: boolean) => void }) {
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useStored('convertor.youtube.v1', { format: 'mp3', height: 1080, bitrate: 192, quality: 80, width: 640, fps: 15 });
  const set = (key: keyof typeof options, value: string | number) => setOptions(s => ({ ...s, [key]: value }));
  const links = urls.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const missing = ['FFmpeg', 'YouTube downloader', 'JavaScript runtime'].filter(name => !info?.engines.find(e => e.name === name)?.path);
  const select = (label: string, key: keyof typeof options, values: (string | number)[], names?: string[]) => <label className="field"><span>{label}</span><div className="select-wrap"><select value={options[key]} onChange={e => set(key, typeof options[key] === 'number' ? Number(e.target.value) : e.target.value)}>{values.map((v, i) => <option key={v} value={v}>{names?.[i] || String(v).toUpperCase()}</option>)}</select></div></label>;
  async function run() {
    setBusy(true);
    try { onJobs(await api.enqueue({ ...requestFor('youtube', [], defaultPreferences, outputDir), inputs: links, outputName: 'YouTube', format: options.format, videoHeight: options.height, videoQuality: options.quality, bitrate: options.bitrate, width: options.width, fps: options.fps })); }
    catch (e) { toast(String(e), true); } finally { setBusy(false); }
  }
  if (!nativeDesktop) return <section className="panel"><h1>YouTube Converter</h1><p className="page-description">YouTube downloading is unavailable on this standalone website because YouTube does not allow browser pages to fetch its media directly.</p><p className="page-description">To convert a video already on your device, choose Video Converter, Video to Audio, or Video to GIF in the sidebar. All other tools run here without installing anything.</p></section>;
  return <>
    <div className="page-heading"><div><h1>YouTube Converter</h1><p className="page-description">Save YouTube videos as audio, video, or animated GIFs.</p></div></div>
    <div className="converter-layout"><section className="panel youtube-source"><h2>Video links</h2><label className="field"><span>YouTube URLs · one video per line</span><textarea aria-label="YouTube URLs" rows={7} placeholder={'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…'} value={urls} onChange={e => setUrls(e.target.value)} /></label><p className="option-hint">Watch, Shorts, and youtu.be links are supported. Up to 50 videos per batch; playlist links are not expanded.</p><p className="option-hint">Downloads require an internet connection. Track progress or cancel in the job queue.</p></section>
    <section className="panel options-panel"><h2>Output</h2>
      <label className="field"><span>Format</span><div className="select-wrap"><select value={options.format} onChange={e => set('format', e.target.value)}><optgroup label="Audio">{audio.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</optgroup><optgroup label="Video & animation">{video.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</optgroup></select></div></label>
      {video.includes(options.format) && options.format !== 'gif' && <>{select('Maximum resolution', 'height', [0,360,480,720,1080,1440,2160], ['Best available','360p','480p','720p','1080p','1440p (2K)','2160p (4K)'])}<label className="field"><span>Video quality · {options.quality}%</span><input aria-label="Video quality" type="range" min={1} max={100} value={options.quality} onChange={e => set('quality', Number(e.target.value))} /></label><p className="option-hint">Keeps aspect ratio and never upscales. Downloads the best source within the selected resolution.</p></>}
      {['mp3','m4a','ogg'].includes(options.format) && select(options.format === 'ogg' ? 'Quality preset' : 'Audio bitrate', 'bitrate', [128,192,320], options.format === 'ogg' ? ['Small','Balanced','High'] : ['128 kbps','192 kbps','320 kbps'])}
      {['wav','flac'].includes(options.format) && <p className="option-hint">Lossless encoding preserves downloaded audio; it cannot restore quality lost in the source.</p>}
      {options.format === 'gif' && <>{select('Maximum width', 'width', [320,480,640,960,1280], ['320 px','480 px','640 px','960 px','1280 px'])}{select('Frame rate', 'fps', [10,15,24,30], ['10 fps','15 fps','24 fps','30 fps'])}</>}
      <p className="option-hint">Files are named after the video title. Duplicate names get a numbered suffix.</p>
      <div className="field"><span>Output folder</span><button className="folder-picker" disabled={!desktop} onClick={chooseFolder}><Folder size={17} /><span>{outputDir || 'Choose a folder'}</span></button></div>
      {desktop && missing.length > 0 && <p className="preview-error">Missing: {missing.join(', ')}. Reinstall the latest version of Convertor to restore the bundled engines.</p>}
      <button className="primary-button" disabled={!desktop || busy || missing.length > 0 || !outputDir || !links.length || links.length > 50} onClick={() => void run()}>{busy && <LoaderCircle size={16} className="spin" />}Download & convert{links.length > 1 ? ` ${links.length} videos` : ''}</button>
    </section></div>
  </>;
}
