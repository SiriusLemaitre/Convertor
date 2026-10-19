import { useEffect, useState } from 'react';
import { nativeDesktop } from './api';

export default function BrowserConnection({ error }: { connected: boolean; error: string }) {
  const [loading, setLoading] = useState('');
  useEffect(() => {
    const update = (event:Event) => setLoading((event as CustomEvent<string>).detail);
    window.addEventListener('convertor-engine',update);
    return () => window.removeEventListener('convertor-engine',update);
  },[]);
  if (nativeDesktop) return null;
  return <section className="browser-connection standalone-intro" aria-label="Browser processing">
    <span className="connection-eyebrow">NO INSTALLATION NEEDED</span>
    <h2>Your files. Your browser.</h2>
    <p>Convert files directly on this device. Add files, choose your settings, then download the results. Your files are never uploaded.</p>
    <p className="connection-note">Audio and video tools load a ~31 MB engine the first time. Processing can be slower on phones; files are limited to 256 MB each. Keep this tab open until you download your results. Multiple pages or frames download as a ZIP.</p>
    {loading && <p className="engine-loading" role="status">{loading}</p>}
    {error && <p className="preview-error" role="alert">{error}</p>}
  </section>;
}
