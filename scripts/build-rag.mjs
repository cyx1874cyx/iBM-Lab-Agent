import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),vendor=join(root,'vendor/dsh-rag'),output=join(root,'lib/rag');
await mkdir(output,{recursive:true});
await build({entryPoints:[join(vendor,'entry.js')],outfile:join(output,'core.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',
 banner:{js:'// DSH-RAG 0.2.1 core (MIT); includes fflate 0.8.3 (MIT). See accompanying licenses.'},
 plugins:[{name:'pinned-rag-parsers',setup(builder){
  builder.onResolve({filter:/^pdfjs-dist\/legacy\/build\/pdf\.mjs$/},()=>({path:'./pdf-runtime.mjs',external:true}));
  builder.onResolve({filter:/^fflate$/},()=>({path:join(vendor,'dependencies/fflate/browser.js')}));
 }}]});
for(const name of ['pdf.mjs','pdf.worker.mjs'])await copyFile(join(vendor,'dependencies/pdfjs',name),join(output,name));
await copyFile(join(vendor,'pdf-runtime.mjs'),join(output,'pdf-runtime.mjs'));
await copyFile(join(vendor,'dependencies/geometry/geometry.cjs'),join(output,'geometry.cjs'));
await copyFile(join(vendor,'dependencies/geometry/LICENSE'),join(output,'LICENSE.geometry'));
for(const [from,to] of [['LICENSE','LICENSE.dsh-rag'],['dependencies/pdfjs/LICENSE','LICENSE.pdfjs'],['dependencies/fflate/LICENSE','LICENSE.fflate']])await copyFile(join(vendor,from),join(output,to));
console.log('iBM Lab retrieval core built with pinned local parsers.');
