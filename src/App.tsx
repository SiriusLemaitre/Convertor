import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, File, Folder, FolderOpen, LayoutGrid, ListOrdered, LoaderCircle, Plus, Search, Settings2, Upload, X } from 'lucide-react';
import { api, desktop, type AppInfo, type InputFile, type Job, type Settings } from './api';
import { acceptsFile, fileName, formatBytes, tools, type ToolId } from './tools';
import ImageOptions, { defaultImageSettings, imageFields, validImageSettings } from './ImageOptions';
import VideoOptions, { defaultVideoSettings } from './VideoOptions';

type Page = 'home' | 'queue' | 'settings' | ToolId;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [search, setSearch] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [files, setFiles] = useState<InputFile[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const [outputName, setOutputName] = useState('Merged document');
  const [bitrate, setBitrate] = useState(192);
  const [width, setWidth] = useState(640);
  const [fps, setFps] = useState(15);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(5);
  const [trim, setTrim] = useState(false);
  const [imageSettings, setImageSettings] = useState(defaultImageSettings);
  const [videoSettings, setVideoSettings] = useState(defaultVideoSettings);
  const [audioFormat, setAudioFormat] = useState('mp3');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const activeJobs = jobs.filter(j => ['running', 'queued'].includes(j.status));
  const tool = tools.find(t => t.id === page);
  const toast = useCallback((text: string, error = false) => setNotice({ text, error }), []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (!desktop) return;
    api.info().then(data => { setInfo(data); setSettingsDraft(data.settings); setOutputDir(data.settings.outputDir); }).catch(e => toast(message(e), true));
    let live = true;
    const refresh = () => api.jobs().then(data => { if (live) setJobs(data); }).catch(() => {});
    void refresh();
    const interval = setInterval(refresh, 500);
    return () => { live = false; clearInterval(interval); };
  }, [toast]);
  const addFiles = useCallback((incoming: InputFile[], id: ToolId) => {
    const selected = tools.find(t => t.id === id)!;
    const accepted = incoming.filter(f => acceptsFile(f.path, selected.extensions));
    if (accepted.length !== incoming.length) toast('Unsupported files skipped.', true);
    setFiles(current => [...new Map([...current, ...accepted].map(file => [file.path, file])).values()]);
  }, [toast]);
  useEffect(() => {
    if (!desktop) return;
    const unlisten = getCurrentWindow().onDragDropEvent(event => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') setDragging(true);
      else setDragging(false);
      if (event.payload.type === 'drop') {
        const selected = tools.find(t => t.id === pageRef.current);
        if (!selected) { toast('Select a tool first.'); return; }
        api.inspect(event.payload.paths).then(data => addFiles(data, selected.id)).catch(e => toast(message(e), true));
      }
    });
    return () => { void unlisten.then(fn => fn()); };
  }, [addFiles, toast]);
  function navigate(next: Page) {
    if (next !== page) { setFiles([]); setDragging(false); }
    setPage(next);
  }
  async function browse() {
    if (!tool) return;
    if (!desktop) { toast('Launch the desktop app to add files.'); return; }
    try { addFiles(await api.files(tool.extensions), tool.id); } catch (e) { toast(message(e), true); }
  }
  async function chooseFolder(settings = false) {
    try {
      const folder = await api.folder();
      if (folder) {
        if (settings) setSettingsDraft(current => current && { ...current, outputDir: folder });
        else setOutputDir(folder);
      }
    } catch (e) { toast(message(e), true); }
  }
  async function convert() {
    if (!tool || busy) return;
    setBusy(true);
    try {
      const added = await api.enqueue({ kind: tool.id, inputs: files.map(f => f.path), outputDir, outputName, bitrate, width, fps, start: trim ? start : 0, duration: trim ? duration : null, ...(page === 'video' ? videoSettings : page === 'image' ? imageFields(imageSettings) : page === 'audio' ? { format: audioFormat } : {}) });
      setJobs(current => [...added, ...current]);
      navigate('queue');
    } catch (e) { toast(message(e), true); }
    finally { setBusy(false); }
  }
  async function saveSettings() {
    if (!settingsDraft) return;
    setBusy(true);
    try {
      const data = await api.settings(settingsDraft);
      setInfo(data); setSettingsDraft(data.settings); setOutputDir(data.settings.outputDir);
      toast('Settings saved.');
    } catch (e) { toast(message(e), true); }
    finally { setBusy(false); }
  }
  async function selectEngine(key: 'ffmpegPath' | 'qpdfPath') {
    try { const path = await api.executable(); if (path) setSettingsDraft(current => current && { ...current, [key]: path }); }
    catch (e) { toast(message(e), true); }
  }
  function moveFile(index: number, delta: number) {
    setFiles(current => {
      const copy = [...current];
      [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
      return copy;
    });
  }
  const engineReady = !!info?.engines.find(e => e.name === (page === 'pdf' ? 'qpdf' : 'FFmpeg'))?.path;
  const visibleTools = tools.filter(t => `${t.name} ${t.extensions.join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="app-shell minimalist">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('home')} aria-label="Convertor home"><span className="brand-mark"><ArrowDownToLine size={23} /></span>convertor</button>
      <nav>
        <button className={`nav-item ${page === 'home' ? 'selected' : ''}`} onClick={() => navigate('home')}><LayoutGrid size={19} />Tools</button>
        <button className={`nav-item ${page === 'queue' ? 'selected' : ''}`} onClick={() => navigate('queue')}><ListOrdered size={19} />Job queue{activeJobs.length > 0 && <span className="count">{activeJobs.length}</span>}</button>
      </nav>
      <nav className="tool-nav">{tools.map(t => <button key={t.id} className={`nav-item ${page === t.id ? 'selected' : ''}`} onClick={() => navigate(t.id)}><t.icon size={18} />{t.name}</button>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => navigate('settings')}><Settings2 size={19} />Settings</button></div>
    </aside>
    <div className="main-shell"><main>
      {!desktop && <div className="preview-banner"><CircleHelp size={17} />Desktop app required for file processing.</div>}
      {page === 'home' && <>
        <div className="page-heading"><h1>Tools</h1><label className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" aria-label="Find a tool" /></label></div>
        <div className="tool-grid">{visibleTools.map(t => <button className={`tool-card ${t.color}`} key={t.id} onClick={() => navigate(t.id)}><span className={`tool-icon ${t.color}`}><t.icon size={27} /></span><h3>{t.name}</h3><ArrowRight size={18} /></button>)}</div>
        {visibleTools.length === 0 && <div className="empty-search">No matching tools.</div>}
        {jobs.length > 0 && <><div className="section-heading recent-heading"><h2>Recent jobs</h2><button className="text-button" onClick={() => navigate('queue')}>View all<ArrowRight size={15} /></button></div><div className="job-list">{jobs.slice(0, 3).map(j => <JobRow key={j.id} job={j} onCancel={() => api.cancel(j.id).catch(e => toast(message(e), true))} onReveal={() => j.output && api.reveal(j.output).catch(e => toast(message(e), true))} />)}</div></>}
      </>}
      {tool && <>
        <button className="back-button" onClick={() => navigate('home')}><ArrowLeft size={16} />Tools</button>
        <div className="tool-page-heading"><span className={`tool-icon ${tool.color}`}><tool.icon size={29} /></span><h1>{tool.name}</h1></div>
        {desktop && info && !engineReady && <div className="engine-warning"><CircleHelp size={18} /><span>{page === 'pdf' ? 'qpdf' : 'FFmpeg'} not found.</span><button onClick={() => navigate('settings')}>Settings<ArrowRight size={14} /></button></div>}
        <div className="converter-layout">
          <section className="panel files-panel">
            <div className="panel-heading"><h2>Files</h2><span>{files.length}</span></div>
            <button className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={browse}><Upload size={25} /><strong>{dragging ? 'Drop files' : `Add ${page === 'pdf' ? 'PDFs' : page === 'image' ? 'images' : page === 'audio' ? 'audio' : 'videos'}`}</strong><span>Drop files or click to browse</span><small>{tool.extensions.join(', ').toUpperCase()}</small></button>
            {files.length > 0 && <><div className="file-list">{files.map((file, index) => <div className="file-row" key={file.path}><span className="file-symbol"><File size={19} /></span><div className="file-detail"><strong title={file.path}>{file.name}</strong><span>{formatBytes(file.size)}</span></div>{page === 'pdf' && <div className="reorder"><button title="Move up" aria-label={`Move ${file.name} up`} disabled={index === 0} onClick={() => moveFile(index, -1)}><ArrowUp size={15} /></button><button title="Move down" aria-label={`Move ${file.name} down`} disabled={index === files.length - 1} onClick={() => moveFile(index, 1)}><ArrowDownToLine size={15} /></button></div>}<button className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter(f => f.path !== file.path))}><X size={16} /></button></div>)}</div><button className="text-button add-more" onClick={browse}><Plus size={16} />Add files</button></>}
          </section>
          <section className="panel options-panel">
            <div className="panel-heading"><h2>Output</h2></div>
            {page === 'image' && <ImageOptions files={files} enabled={engineReady} value={imageSettings} onChange={setImageSettings} />}
            {page === 'video' && <VideoOptions files={files} enabled={engineReady} value={videoSettings} onChange={setVideoSettings} />}
            {page === 'audio' && <label className="field"><span>Format</span><div className="select-wrap"><select value={audioFormat} onChange={event => setAudioFormat(event.target.value)}>{['mp3', 'ogg', 'wav', 'flac', 'm4a'].map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select><ChevronDown size={15} /></div></label>}
            {(page === 'mp3' || page === 'audio' && !['wav', 'flac', 'ogg'].includes(audioFormat)) && <div className="field"><span>Bitrate</span><div className="segmented">{[128, 192, 320].map(b => <button className={bitrate === b ? 'active' : ''} key={b} onClick={() => setBitrate(b)}>{b} kbps</button>)}</div></div>}
            {page === 'audio' && audioFormat === 'ogg' && <div className="field"><span>Quality</span><div className="segmented">{[128, 192, 320].map((b, index) => <button className={bitrate === b ? 'active' : ''} key={b} onClick={() => setBitrate(b)}>{['Small', 'Balanced', 'High'][index]}</button>)}</div></div>}
            {page === 'gif' && <>
              <div className="field-pair"><label className="field"><span>Max width</span><div className="select-wrap"><select value={width} onChange={e => setWidth(Number(e.target.value))}>{[320, 480, 640, 960, 1280].map(w => <option key={w} value={w}>{w} px</option>)}</select><ChevronDown size={15} /></div></label><label className="field"><span>Frame rate</span><div className="select-wrap"><select value={fps} onChange={e => setFps(Number(e.target.value))}>{[10, 15, 24, 30].map(f => <option key={f} value={f}>{f} fps</option>)}</select><ChevronDown size={15} /></div></label></div>
              <div className="field"><span>Duration</span><div className="segmented"><button className={!trim ? 'active' : ''} aria-pressed={!trim} onClick={() => setTrim(false)}>Full video</button><button className={trim ? 'active' : ''} aria-pressed={trim} onClick={() => setTrim(true)}>Trim</button></div></div>
              {trim && <div className="field-pair"><label className="field"><span>Start (seconds)</span><input type="number" min="0" value={start} onChange={e => setStart(Number(e.target.value))} /></label><label className="field"><span>Length (seconds)</span><input type="number" min="0.1" step="0.1" value={duration} onChange={e => setDuration(Number(e.target.value))} /></label></div>}
            </>}
            {page === 'pdf' && <label className="field"><span>Document name</span><input value={outputName} onChange={e => setOutputName(e.target.value)} maxLength={100} /></label>}
            <div className="field"><span>Save to</span><button className="folder-picker" onClick={() => chooseFolder()} disabled={!desktop}><Folder size={17} /><span title={outputDir}>{outputDir ? fileName(outputDir) : 'Source folder'}</span><ChevronRight size={15} /></button></div>
            <button className="primary-button convert-button" disabled={!desktop || !engineReady || busy || files.length < (page === 'pdf' ? 2 : 1) || page === 'image' && !validImageSettings(imageSettings)} onClick={convert}>{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}{page === 'pdf' ? 'Merge PDFs' : `Convert ${files.length > 1 ? `${files.length} files` : `to ${page === 'video' ? videoSettings.format.toUpperCase() : page === 'image' ? imageSettings.format.toUpperCase() : page === 'audio' ? audioFormat.toUpperCase() : tool.short}`}`}</button>
          </section>
        </div>
      </>}
      {page === 'queue' && <>
        <div className="page-heading compact"><h1>Job queue</h1><button className="secondary-button" disabled={!jobs.some(j => !['running', 'queued'].includes(j.status))} onClick={() => api.clear().then(() => api.jobs()).then(setJobs).catch(e => toast(message(e), true))}><CheckCheck size={16} />Clear finished</button></div>
        {jobs.length ? <div className="job-list queue-list">{jobs.map(j => <JobRow key={j.id} job={j} onCancel={() => api.cancel(j.id).catch(e => toast(message(e), true))} onReveal={() => j.output && api.reveal(j.output).catch(e => toast(message(e), true))} />)}</div> : <div className="large-empty"><p>No jobs.</p><button className="secondary-button" onClick={() => navigate('home')}>Tools<ArrowRight size={16} /></button></div>}
      </>}
      {page === 'settings' && <>
        <div className="page-heading compact"><h1>Settings</h1></div>
        <section className="panel settings-panel">
          <div className="field"><span>Output folder</span><button className="folder-picker" disabled={!desktop} onClick={() => chooseFolder(true)}><Folder size={17} /><span title={settingsDraft?.outputDir}>{settingsDraft?.outputDir || 'Source folder'}</span><ChevronRight size={15} /></button>{settingsDraft?.outputDir && <button className="text-button" onClick={() => setSettingsDraft(s => s && { ...s, outputDir: '' })}>Reset</button>}</div>
          <label className="field"><span>Simultaneous jobs</span><div className="select-wrap"><select disabled={!desktop} value={settingsDraft?.concurrency || 1} onChange={e => setSettingsDraft(s => s && { ...s, concurrency: Number(e.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select><ChevronDown size={15} /></div></label>
          <details className="engine-details"><summary>Engines</summary>{(['ffmpegPath', 'qpdfPath'] as const).map((key, index) => <div className="engine-setting" key={key}><div><strong>{index === 0 ? 'FFmpeg' : 'qpdf'}</strong><span className={info?.engines[index]?.path ? 'engine-ok' : ''}>{info?.engines[index]?.path ? 'Available' : 'Not found'}</span></div><div className="engine-input"><input aria-label={index === 0 ? 'FFmpeg path' : 'qpdf path'} disabled={!desktop} placeholder="Auto-detect" value={settingsDraft?.[key] || ''} onChange={e => setSettingsDraft(s => s && { ...s, [key]: e.target.value })} /><button className="secondary-button" disabled={!desktop} onClick={() => selectEngine(key)}>Browse</button></div></div>)}</details>
          <button className="primary-button" disabled={!desktop || busy || !settingsDraft} onClick={saveSettings}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save settings</button>
        </section>
      </>}
    </main></div>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19} /> : <Check size={19} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
  </div>;
}


function JobRow({ job, onCancel, onReveal }: { job: Job; onCancel: () => void; onReveal: () => void }) {
  const tool = tools.find(t => t.id === job.kind)!;
  const active = job.status === 'running' || job.status === 'queued';
  return <div className="job-row"><span className={`tool-icon small ${tool.color}`}><tool.icon size={20} /></span><div className="job-detail"><strong title={job.output || job.label}>{job.label}</strong><span>{tool.name}{job.output && ` · ${fileName(job.output)}`}</span>{job.status === 'running' && <div className="progress-track"><div style={{ width: `${Math.max(2, job.progress)}%` }} /></div>}{job.error && <p className="job-error">{job.error}</p>}</div><span className={`job-status ${job.status}`}>{job.status === 'running' && <LoaderCircle size={13} className="spin" />}{job.status === 'completed' && <Check size={14} />}{job.status === 'running' ? `${Math.round(job.progress)}%` : job.status}</span>{active ? <button className="icon-button" aria-label={`Cancel ${job.label}`} title="Cancel job" onClick={onCancel}><X size={17} /></button> : job.status === 'completed' ? <button className="icon-button" aria-label={`Show ${job.label} in folder`} title="Show in folder" onClick={onReveal}><FolderOpen size={18} /></button> : <span className="icon-spacer" />}</div>;
}
