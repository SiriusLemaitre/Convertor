import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Check, CheckCheck, ChevronRight, CircleHelp, File, Folder, FolderOpen, LayoutGrid, ListOrdered, LoaderCircle, Plus, Search, Settings2, Upload, X, Eye, Save } from 'lucide-react';
import { api, desktop, type AppInfo, type InputFile, type Job, type Settings } from './api';
import { acceptsFile, categories, fileName, formatBytes, tools, type Tool, type ToolId, type Category } from './tools';
import { defaultPreferences, useStored, type Preferences } from './preferences';
import ToolOptions, { requestFor, validOptions } from './ToolOptions';
import PreviewPanel from './PreviewPanel';
import YouTubePage from './YouTubePage';

type Page = 'home' | 'queue' | 'settings' | ToolId;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function useNavigation() {
  const [page, setPage] = useState<Page>('home');
  const entries = useRef<Page[]>(['home']);
  const [position, setPosition] = useState(0);
  const cursor = useRef(0);
  useEffect(() => {
    window.history.replaceState({ convertor: 0 }, '');
    const pop = (event: PopStateEvent) => {
      const index = event.state?.convertor;
      if (typeof index === 'number' && entries.current[index]) { cursor.current = index; setPosition(index); setPage(entries.current[index]); }
    };
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault(); event.stopPropagation();
      if (event.type === 'mouseup') {
        if (event.button === 3 && cursor.current > 0) window.history.back();
        if (event.button === 4 && cursor.current < entries.current.length - 1) window.history.forward();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'ArrowLeft' && cursor.current > 0) window.history.back();
        if (event.key === 'ArrowRight' && cursor.current < entries.current.length - 1) window.history.forward();
      }
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', key);
    for (const type of (['mousedown','mouseup','auxclick'] as const)) window.addEventListener(type, mouse, true);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); for (const type of (['mousedown','mouseup','auxclick'] as const)) window.removeEventListener(type, mouse, true); };
  }, []);
  const navigate = useCallback((next: Page) => {
    if (entries.current[cursor.current] === next) return;
    entries.current = [...entries.current.slice(0, cursor.current+1), next];
    cursor.current += 1; window.history.pushState({ convertor: cursor.current }, '');
    setPosition(cursor.current); setPage(next);
  }, []);
  return { page, navigate, canBack: position > 0, canForward: position < entries.current.length-1 };
}
export default function App() {
  const { page, navigate, canBack, canForward } = useNavigation();
  const [appearance, setAppearance] = useStored<'light' | 'dark'>('convertor.theme.v1', 'light');
  const [autoImagePreview, setAutoImagePreview] = useStored('convertor.autoImagePreview.v1', true);
  useEffect(() => { document.documentElement.dataset.theme = appearance; }, [appearance]);
  const [category, setCategory] = useState<Category | 'All'>('All');
  const [search, setSearch] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filesByTool, setFilesByTool] = useState<Partial<Record<ToolId, InputFile[]>>>({});
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [previewJob, setPreviewJob] = useState<InputFile | null>(null);
  const pageRef = useRef(page); pageRef.current = page;
  const tool = tools.find(t => t.id === page);
  const toast = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const activeJobs = jobs.filter(j => ['queued','running'].includes(j.status));
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(id); }, [notice]);
  useEffect(() => {
    if (!desktop) return;
    api.info().then(data => { setInfo(data); setSettingsDraft(data.settings); setOutputDir(data.settings.outputDir); }).catch(e => toast(message(e), true));
    let live = true;
    const refresh = () => api.jobs().then(data => { if (live) setJobs(data); }).catch(() => {});
    void refresh(); const id = setInterval(refresh, 500);
    return () => { live = false; clearInterval(id); };
  }, [toast]);
  const addFiles = useCallback((incoming: InputFile[], id: ToolId) => {
    const selected = tools.find(t => t.id === id)!;
    const accepted = incoming.filter(f => acceptsFile(f.path, selected.extensions));
    if (accepted.length !== incoming.length) toast('Unsupported files skipped.', true);
    setFilesByTool(current => ({ ...current, [id]: [...new Map([...(current[id] || []), ...accepted].map(f => [f.path,f])).values()] }));
  }, [toast]);
  useEffect(() => {
    if (!desktop) return;
    const listener = getCurrentWindow().onDragDropEvent(event => {
      setDragging(event.payload.type === 'enter' || event.payload.type === 'over');
      if (event.payload.type !== 'drop') return;
      const selected = tools.find(t => t.id === pageRef.current);
      if (selected?.id === 'youtube') { toast('Paste YouTube links into the video links box.'); return; }
      if (!selected) { toast('Choose a tool, then drop your files.'); return; }
      api.inspect(event.payload.paths).then(data => addFiles(data, selected.id)).catch(e => toast(message(e), true));
    });
    return () => { void listener.then(fn => fn()); };
  }, [toast, addFiles]);
  useEffect(() => { setDragging(false); }, [page]);
  async function browse() {
    if (!tool) return;
    if (!desktop) { toast('Launch the desktop app to add files.'); return; }
    try { addFiles(await api.files(tool.extensions), tool.id); } catch (e) { toast(message(e), true); }
  }
  async function chooseFolder(settings = false) {
    try { const folder = await api.folder(); if (folder) { if (settings) setSettingsDraft(s => s && ({ ...s, outputDir: folder })); else setOutputDir(folder); } } catch (e) { toast(message(e), true); }
  }
  async function saveSettings() {
    if (!settingsDraft) return;
    setBusy(true);
    try { const data = await api.settings(settingsDraft); setInfo(data); setSettingsDraft(data.settings); setOutputDir(data.settings.outputDir); toast('Settings saved.'); } catch (e) { toast(message(e), true); } finally { setBusy(false); }
  }
  async function selectEngine(key: 'ffmpegPath' | 'qpdfPath' | 'pdfRendererPath') {
    try { const path = await api.executable(); if (path) setSettingsDraft(s => s && ({ ...s, [key]: path })); } catch (e) { toast(message(e), true); }
  }
  async function showPreview(job: Job) {
    if (!job.output) return;
    try { const inspected = await api.inspect([job.output]); setPreviewJob(inspected[0]); } catch { toast('This job produced a folder. Open it to view the exported files.'); }
  }
  const visible = tools.filter(t => (category === 'All' || category === t.category || category === 'Audio' && t.id === 'trim') && `${t.name} ${t.description} ${('displayExtensions' in t ? t.displayExtensions : t.extensions).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const rows = (items: Job[]) => items.map(j => <JobRow key={j.id} job={j} onCancel={() => api.cancel(j.id).catch(e => toast(message(e), true))} onReveal={() => j.output && api.reveal(j.output).catch(e => toast(message(e), true))} onPreview={() => void showPreview(j)} />);
  return <div className="app-shell minimalist">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('home')} aria-label="Convertor home"><span className="brand-mark"><ArrowDown size={23} /></span>convertor</button>
      <nav aria-label="Main navigation"><button className={`nav-item ${page === 'home' ? 'selected' : ''}`} onClick={() => { setCategory('All'); navigate('home'); }}><LayoutGrid size={19} />All tools</button><button className={`nav-item ${page === 'queue' ? 'selected' : ''}`} onClick={() => navigate('queue')}><ListOrdered size={19} />Job queue{activeJobs.length > 0 && <span className="count">{activeJobs.length}</span>}</button></nav>
      <nav className="tool-nav" aria-label="Tools by category">{categories.map(c => <div className="nav-category" key={c}><button className="category-label" aria-label={`Browse ${c} tools`} onClick={() => { setCategory(c); setSearch(''); navigate('home'); }}>{c}<ChevronRight size={12} /></button>{tools.filter(t => t.category === c || c === 'Audio' && t.id === 'trim').map(t => <button key={t.id} className={`nav-item ${page === t.id ? 'selected' : ''}`} aria-current={page === t.id ? 'page' : undefined} onClick={() => navigate(t.id)}><t.icon size={17} /><span>{t.name}</span></button>)}</div>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} />Settings</button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="history-controls"><button className="icon-button" aria-label="Go back" title="Back (Alt+Left or mouse side button)" disabled={!canBack} onClick={() => window.history.back()}><ArrowLeft size={18} /></button><button className="icon-button" aria-label="Go forward" title="Forward (Alt+Right or mouse side button)" disabled={!canForward} onClick={() => window.history.forward()}><ArrowRight size={18} /></button></div><span>{tool ? `${tool.category} / ${tool.name}` : page === 'home' ? 'Your file toolbox' : page === 'queue' ? 'Job queue' : 'Settings'}</span></header><main>
      {!desktop && <div className="preview-banner"><CircleHelp size={17} />Desktop app required for file processing.</div>}
      {page === 'home' && <>
        <div className="page-heading"><div><h1>Tools</h1><p className="page-description">Convert, edit, and prepare your files in one place.</p></div><label className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tools or formats" aria-label="Find a tool" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label></div>
        <div className="category-tabs" role="group" aria-label="Filter by category">{(['All',...categories] as const).map(c => <button key={c} className={category === c ? 'active' : ''} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
        {categories.map(c => { if (category !== 'All' && c !== category) return null; const group = visible.filter(t => t.category === c || category === 'Audio' && c === 'Audio' && t.id === 'trim'); if (!group.length) return null; return <section className="tool-category" key={c}><div className="section-heading"><h2>{c}</h2><span>{group.length} tools</span></div><div className="tool-grid">{group.map(t => <button className={`tool-card ${t.color}`} key={t.id} onClick={() => navigate(t.id)}><span className={`tool-icon ${t.color}`}><t.icon size={24} /></span><div><h3>{t.name}</h3><p>{t.description}</p></div><ArrowRight size={17} /></button>)}</div></section>; })}
        {visible.length === 0 && <div className="empty-search">No matching tools. Try another name or format.</div>}
        {jobs.length > 0 && <><div className="section-heading recent-heading"><h2>Recent jobs</h2><button className="text-button" onClick={() => navigate('queue')}>View all<ArrowRight size={15} /></button></div><div className="job-list">{rows(jobs.slice(0,3))}</div></>}
      </>}
      {tool && tool.id !== 'youtube' && <ToolPage key={tool.id} tool={tool} autoImagePreview={autoImagePreview} files={filesByTool[tool.id] || []} setFiles={next => setFilesByTool(s => ({ ...s, [tool.id]: next }))} info={info} dragging={dragging} browse={browse} outputDir={outputDir} chooseFolder={() => chooseFolder()} onJobs={added => { setJobs(s => [...added,...s]); navigate('queue'); }} toast={toast} />}
      {page === 'youtube' && <YouTubePage info={info} outputDir={outputDir} chooseFolder={() => chooseFolder()} onJobs={added => { setJobs(s => [...added,...s]); navigate('queue'); }} toast={toast} />}
      {page === 'queue' && <><div className="page-heading compact"><div><h1>Job queue</h1><p className="page-description">{activeJobs.length ? `${activeJobs.length} jobs in progress` : 'Your conversions and exports for this session.'}</p></div><button className="secondary-button" disabled={!jobs.some(j => !['running','queued'].includes(j.status))} onClick={() => api.clear().then(() => api.jobs()).then(setJobs).catch(e => toast(message(e), true))}><CheckCheck size={16} />Clear finished</button></div>{jobs.length ? <div className="job-list queue-list">{rows(jobs)}</div> : <div className="large-empty"><p>No jobs.</p><button className="secondary-button" onClick={() => navigate('home')}>Choose a tool<ArrowRight size={16} /></button></div>}</>}
      {page === 'settings' && <><div className="page-heading compact"><h1>Settings</h1></div><section className="panel settings-panel"><label className="field"><span>Appearance</span><div className="select-wrap"><select aria-label="Appearance" value={appearance} onChange={e => setAppearance(e.target.value as 'light' | 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></div></label><label className="checkbox-field"><input type="checkbox" checked={autoImagePreview} onChange={e => setAutoImagePreview(e.target.checked)} />Automatically preview image changes</label><p className="option-hint">Appearance and preview preferences are saved automatically.</p><div className="field"><span>Default output folder</span><button className="folder-picker" disabled={!desktop} onClick={() => chooseFolder(true)}><Folder size={17} /><span title={settingsDraft?.outputDir}>{settingsDraft?.outputDir || 'Source folder'}</span><ChevronRight size={15} /></button>{settingsDraft?.outputDir && <button className="text-button" onClick={() => setSettingsDraft(s => s && ({ ...s, outputDir: '' }))}>Use source folder</button>}</div><label className="field"><span>Simultaneous jobs</span><div className="select-wrap"><select disabled={!desktop} value={settingsDraft?.concurrency || 1} onChange={e => setSettingsDraft(s => s && ({ ...s, concurrency: Number(e.target.value) }))}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}</select></div></label><details className="engine-details"><summary>Processing engines</summary>{(['ffmpegPath','qpdfPath','pdfRendererPath'] as const).map((key,index) => <div className="engine-setting" key={key}><div><strong>{['FFmpeg','qpdf','PDF renderer (pdftoppm)'][index]}</strong><span className={info?.engines[index]?.path ? 'engine-ok' : ''}>{info?.engines[index]?.path ? 'Available' : 'Not found'}</span></div><div className="engine-input"><input aria-label={`${['FFmpeg','qpdf','PDF renderer'][index]} path`} disabled={!desktop} placeholder="Auto-detect" value={settingsDraft?.[key] || ''} onChange={e => setSettingsDraft(s => s && ({ ...s, [key]: e.target.value }))} /><button className="secondary-button" disabled={!desktop} onClick={() => selectEngine(key)}>Browse</button></div></div>)}</details><button className="primary-button" disabled={!desktop || busy || !settingsDraft} onClick={saveSettings}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}Save settings</button></section></>}
    </main></div>
    {previewJob && <div className="modal-backdrop" onClick={() => setPreviewJob(null)}><section className="preview-modal" role="dialog" aria-modal="true" aria-label="Output preview" onClick={e => e.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Close preview" onClick={() => setPreviewJob(null)}><X size={20} /></button><h2>{previewJob.name}</h2><p className="page-description">Saved output · {formatBytes(previewJob.size)}</p><PreviewPanel request={requestFor('metadata',[previewJob],defaultPreferences)} /></section></div>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19} /> : <Check size={19} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
  </div>;
}
function ToolPage({ tool, autoImagePreview, files, setFiles, info, dragging, browse, outputDir, chooseFolder, onJobs, toast }: { tool: Tool; autoImagePreview: boolean; files: InputFile[]; setFiles: (files: InputFile[]) => void; info: AppInfo | null; dragging: boolean; browse: () => void; outputDir: string; chooseFolder: () => void; onJobs: (jobs: Job[]) => void; toast: (message: string, error?: boolean) => void }) {
  const [p,setP] = useStored<Preferences>(`convertor.options.v1.${tool.id}`,defaultPreferences);
  const [presets,setPresets] = useStored<{ name: string; value: Preferences }[]>(`convertor.presets.v1.${tool.id}`,[]);
  const [presetName,setPresetName] = useState('');
  const [selectedPreset,setSelectedPreset] = useState('');
  const [busy,setBusy] = useState(false);
  const request = requestFor(tool.id, files, p, outputDir);
  const needs = tool.id === 'pdf-images' ? ['PDF renderer'] : ['pdf','pdf-pages'].includes(tool.id) ? ['qpdf'] : tool.id === 'metadata' ? [...new Set(files.map(f => /\.pdf$/i.test(f.path) ? 'qpdf' : 'FFmpeg'))] : ['FFmpeg'];
  const engineReady = needs.every(name => !!info?.engines.find(e => e.name === name)?.path);
  const missing = needs.filter(name => !info?.engines.find(e => e.name === name)?.path);
  const reorder = ['pdf','images-pdf'].includes(tool.id);
  function move(index: number, delta: number) { const next = [...files]; [next[index],next[index+delta]] = [next[index+delta],next[index]]; setFiles(next); }
  async function run() {
    if (busy) return;
    setBusy(true);
    try { onJobs(await api.enqueue(request)); } catch (e) { toast(message(e),true); } finally { setBusy(false); }
  }
  function savePreset() {
    const name = presetName.trim(); if (!name) return;
    setPresets(s => [...s.filter(item => item.name !== name),{ name,value:p }]); setPresetName(''); setSelectedPreset(name); toast('Preset saved.');
  }
  const label = tool.id === 'pdf' ? 'Merge PDFs' : tool.id === 'images-pdf' ? 'Create PDF' : tool.id === 'pdf-pages' ? `${p.operation === 'split' ? 'Split' : p.operation === 'remove' ? 'Remove' : 'Extract'} pages` : tool.id === 'trim' ? 'Export clip' : tool.id === 'frames' ? 'Export frames' : tool.id === 'metadata' ? 'Save clean copies' : tool.id === 'compress' ? 'Compress files' : tool.id === 'image-edit' ? 'Export images' : `Convert ${files.length > 1 ? `${files.length} files` : `to ${tool.id === 'video' ? p.video.format.toUpperCase() : tool.id === 'image' ? p.image.format.toUpperCase() : ['audio','mp3'].includes(tool.id) ? p.audioFormat.toUpperCase() : tool.short}`}`;
  return <>
    <div className="tool-page-heading"><span className={`tool-icon ${tool.color}`}><tool.icon size={28} /></span><div><h1>{tool.name}</h1><p className="page-description">{tool.description}</p></div></div>
    {desktop && info && !engineReady && <div className="engine-warning"><CircleHelp size={17} /><span>{missing.join(', ')} unavailable. Check processing engines in Settings.</span></div>}
    <div className="converter-layout"><div className="source-column"><section className="panel files-panel"><div className="panel-heading"><h2>Source files</h2><span>{files.length ? `${files.length} · ${formatBytes(files.reduce((n,f) => n+f.size,0))}` : 'Start here'}</span></div><button className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={browse}><Upload size={25} /><strong>{dragging ? 'Drop files' : `Add ${tool.id === 'pdf' || tool.id.startsWith('pdf-') ? 'PDFs' : ['image','image-edit','images-pdf'].includes(tool.id) ? 'images' : tool.id === 'audio' ? 'audio' : ['metadata','compress','trim'].includes(tool.id) ? 'files' : 'videos'}`}</strong><span>Drop files or click to browse</span><small>{('displayExtensions' in tool ? tool.displayExtensions : tool.extensions).join(', ').toUpperCase()}</small></button>{files.length > 0 && <><div className="file-list">{files.map((file,index) => <div className="file-row" key={file.path}><span className="file-symbol"><File size={18} /></span><div className="file-detail"><a className="file-link" href="#" title={`Open ${file.path}`} onClick={e => { e.preventDefault(); void api.open(file.path).catch(error => toast(message(error), true)); }}>{file.name}</a><span>{formatBytes(file.size)}</span></div>{reorder && <div className="reorder"><button aria-label={`Move ${file.name} up`} disabled={index === 0} onClick={() => move(index,-1)}><ArrowUp size={15} /></button><button aria-label={`Move ${file.name} down`} disabled={index === files.length-1} onClick={() => move(index,1)}><ArrowDown size={15} /></button></div>}<button className="icon-button" aria-label={`Reveal ${file.name} in file explorer`} title="Reveal in file explorer" onClick={() => void api.reveal(file.path).catch(error => toast(message(error), true))}><FolderOpen size={16} /></button><button className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter(f => f.path !== file.path))}><X size={16} /></button></div>)}</div><div className="file-actions"><button className="text-button" onClick={browse}><Plus size={15} />Add files</button><button className="text-button" onClick={() => setFiles([])}>Clear list</button></div></>}</section><PreviewPanel request={request} autoImagePreview={autoImagePreview} previewEnabled={engineReady && validOptions(tool.id,p)} onSelection={['trim','gif','frames'].includes(tool.id) ? (key,time) => setP(s => ({ ...s,[key]:Number(time.toFixed(2)) })) : undefined} /></div>
    <section className="panel options-panel"><div className="panel-heading"><h2>Options & output</h2><button className="text-button" onClick={() => { setP(defaultPreferences); setSelectedPreset(''); }}>Reset options</button></div>
      <details className="preset-details"><summary>Saved presets{presets.length ? ` (${presets.length})` : ''}</summary>{presets.length > 0 && <div className="preset-row"><select aria-label="Saved preset" value={selectedPreset} onChange={e => { setSelectedPreset(e.target.value); const preset = presets.find(item => item.name === e.target.value); if (preset) setP(preset.value); }}><option value="">Choose a preset</option>{presets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button className="icon-button" disabled={!selectedPreset} aria-label="Delete selected preset" onClick={() => { setPresets(s => s.filter(item => item.name !== selectedPreset)); setSelectedPreset(''); }}><X size={16} /></button></div>}<div className="preset-row"><input aria-label="Preset name" placeholder="Name these settings" maxLength={50} value={presetName} onChange={e => setPresetName(e.target.value)} /><button className="secondary-button" disabled={!presetName.trim()} onClick={savePreset}><Save size={14} />Save</button></div></details>
      <ToolOptions kind={tool.id} files={files} enabled={engineReady} value={p} onChange={setP} />
      <div className="field"><span>Save to</span><button className="folder-picker" onClick={chooseFolder} disabled={!desktop}><Folder size={17} /><span title={outputDir}>{outputDir ? fileName(outputDir) : 'Source folder'}</span><ChevronRight size={15} /></button></div><button className="primary-button convert-button" disabled={!desktop || !engineReady || busy || files.length < (tool.id === 'pdf' ? 2 : 1) || !validOptions(tool.id,p)} onClick={run}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{label}</button><p className="safe-output-note">Originals stay untouched. Existing files are never replaced.</p>
    </section></div>
  </>;
}
function JobRow({ job, onCancel, onReveal, onPreview }: { job: Job; onCancel: () => void; onReveal: () => void; onPreview: () => void }) {
  const tool = tools.find(t => t.id === job.kind);
  const Icon = tool?.icon || File;
  const active = ['running','queued'].includes(job.status);
  return <div className="job-row"><span className={`tool-icon small ${tool?.color || 'violet'}`}><Icon size={20} /></span><div className="job-detail"><strong title={job.output || job.label}>{job.label}</strong><span>{tool?.name || job.kind}{job.output && ` · ${fileName(job.output)}`}</span>{job.status === 'running' && <div className="progress-track"><div style={{ width: `${Math.max(2,job.progress)}%` }} /></div>}{job.error && <p className="job-error">{job.error}</p>}</div><span className={`job-status ${job.status}`}>{job.status === 'running' && <LoaderCircle size={13} className="spin" />}{job.status === 'completed' && <Check size={14} />}{job.status === 'running' ? `${Math.round(job.progress)}%` : job.status}</span>{active ? <button className="icon-button" aria-label={`Cancel ${job.label}`} onClick={onCancel}><X size={17} /></button> : job.status === 'completed' ? <>{!job.outputIsDirectory && <button className="icon-button" aria-label={`Preview ${job.label}`} title="Preview output" onClick={onPreview}><Eye size={17} /></button>}<button className="icon-button" aria-label={`Show ${job.label} in folder`} title="Open output folder" onClick={onReveal}><FolderOpen size={18} /></button></> : <span className="icon-spacer" />}</div>;
}
