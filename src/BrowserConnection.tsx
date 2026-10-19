import { useState } from 'react';
import { api, connectHelper, disconnectHelper, desktop, nativeDesktop } from './api';

export default function BrowserConnection({ connected, error }: { connected: boolean; error: string }) {
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState('');
  if (nativeDesktop) return null;
  if (connected) return <div className="browser-connected"><span>Processing locally on this computer</span><button className="text-button" onClick={disconnectHelper}>Disconnect</button><button className="text-button" onClick={() => void api.quit().then(disconnectHelper).catch(e => setProblem(String(e)))}>Quit Convertor</button>{problem && <span role="alert">{problem}</span>}</div>;
  return <section className="browser-connection" aria-label="Connect local processing">
    <div><span className="connection-eyebrow">CONVERTOR FOR THE WEB</span><h2>Your toolbox, in your browser.</h2><p>Browse every tool here. To convert files, connect Convertor on this Windows computer. Files stay on your computer.</p></div>
    <ol><li><a href="https://github.com/SiriusLemaitre/Convertor/releases/latest" target="_blank" rel="noreferrer">Download Convertor for Windows</a> and install or extract the portable ZIP.</li><li>Open the desktop app and choose <strong>Open hosted page</strong> in the toolbar. From the portable folder, you can also run <strong>Start-Web-Hosted.cmd</strong>.</li><li>The page opens already paired. Allow local network access if your browser asks.</li></ol>
    <p className="connection-note">For offline use, choose <strong>Open in browser</strong> in the desktop app or run <strong>Start-Web.cmd</strong>. Keep Convertor running while you work. On phones, tablets, or computers without the helper, you can explore the tools here.</p>
    <details><summary>Connect using an existing browser link</summary><form onSubmit={e => { e.preventDefault(); try { connectHelper(link); } catch (error) { setProblem(String(error)); } }}><label className="field"><span>Paste the link opened by Convertor on this computer</span><input type="password" value={link} onChange={e => setLink(e.target.value)} autoComplete="off" /></label><button className="secondary-button" disabled={!link.trim()}>Connect</button></form><p className="connection-note">This link grants access to your local Convertor session. Keep it private.</p></details>
    {(error || problem) && <p className="preview-error" role="alert">{problem || error}</p>}
    {desktop && !error && <p role="status">Connecting to your local Convertor…</p>}
  </section>;
}
