import type { InputFile } from './api';

const files = new Map<string, { blob: Blob; name: string; url: string }>();
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export function storeFile(blob: Blob, name: string): InputFile {
  const path = `/browser/${crypto.randomUUID()}/${name.replace(/[\\/]/g, '_')}`;
  files.set(path, { blob, name, url: URL.createObjectURL(blob) });
  return { path, name, size: blob.size };
}
export function addBrowserFiles(incoming: Iterable<File>): InputFile[] {
  const selected = [...incoming];
  if (selected.some(file => file.size > MAX_FILE_BYTES)) throw new Error('Browser processing supports files up to 256 MB each. Choose a smaller file.');
  if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES * 2) throw new Error('Choose at most 512 MB of files per batch.');
  if ([...files.values()].reduce((sum,file)=>sum+file.blob.size,0) + selected.reduce((sum,file)=>sum+file.size,0) > MAX_FILE_BYTES * 3) throw new Error('This tab is holding too many files. Download your results and refresh the page to release browser memory.');
  return selected.map(file => storeFile(file, file.name));
}
export function fileBlob(path: string): Blob {
  const file = files.get(path);
  if (!file) throw new Error('This file is no longer available. Add it again.');
  return file.blob;
}
export function browserSource(path: string): string { return files.get(path)?.url || ''; }
export function forgetFile(path: string) {
  const file = files.get(path);
  if (file) URL.revokeObjectURL(file.url);
  files.delete(path);
}
export function downloadFile(path: string) {
  const file = files.get(path);
  if (!file) throw new Error('This download is no longer available.');
  const anchor = document.createElement('a');
  anchor.href = file.url; anchor.download = file.name;
  document.body.append(anchor); anchor.click(); anchor.remove();
}
export function inspectBrowserFiles(paths: string[]): InputFile[] {
  return paths.map(path => { const blob = fileBlob(path); return { path, name: files.get(path)!.name, size: blob.size }; });
}
export function pickBrowserFiles(extensions: readonly string[]): Promise<InputFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.hidden = true;
    if (!extensions.includes('*')) input.accept = extensions.map(ext => `.${ext}`).join(',');
    document.body.append(input);
    input.addEventListener('change', () => { try { resolve(addBrowserFiles(input.files || [])); } catch (e) { reject(e); } finally { input.remove(); } }, { once: true });
    input.addEventListener('cancel', () => { input.remove(); resolve([]); }, { once: true });
    input.click();
  });
}
