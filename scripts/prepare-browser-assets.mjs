import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/pdfjs');
mkdirSync(root,{recursive:true});
for (const directory of ['cmaps','standard_fonts','wasm','iccs']) cpSync(path.resolve('node_modules/pdfjs-dist',directory),path.join(root,directory),{recursive:true});
copyFileSync('node_modules/pdfjs-dist/LICENSE',path.join(root,'LICENSE'));
mkdirSync('public/licenses',{recursive:true});
copyFileSync('node_modules/pdf-lib/LICENSE.md','public/licenses/pdf-lib.txt');
copyFileSync('node_modules/pdfjs-dist/LICENSE','public/licenses/pdfjs.txt');
copyFileSync('node_modules/fflate/LICENSE','public/licenses/fflate.txt');
