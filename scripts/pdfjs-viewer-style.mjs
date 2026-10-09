import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
// Preserve upstream CSS, scope it to the reader and embed its small icon assets.
export function pdfViewerStylePlugin(){return {name:'pdf-viewer-style',setup(build){build.onLoad({filter:/[\\/]pdfjs[\\/]web[\\/]pdf_viewer\.css$/},async({path})=>{
 const css=await readFile(path,'utf8'),images=[...new Set([...css.matchAll(/url\(["']?(images\/[\w.-]+)["']?\)/g)].map(match=>match[1]))];
 const data=new Map(await Promise.all(images.map(async name=>[name,'data:image/'+(name.endsWith('.svg')?'svg+xml':name.endsWith('.gif')?'gif':'png')+';base64,'+(await readFile(join(dirname(path),name))).toString('base64')])));
 const scoped=css.replaceAll(':root','.ib-reader').replace(/url\(["']?(images\/[\w.-]+)["']?\)/g,(_,name)=>'url("'+data.get(name)+'")');
 return {contents:'@scope (.ib-reader) {\n'+scoped+'\n}',loader:'text'};
});}};}
