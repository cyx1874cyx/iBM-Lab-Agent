/** Compose previously verified native Origin exports plus imported raster files. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {bootLite} from '../../tests/helpers/boot-lite.mjs';import {plotSpecSchema} from '../../src/plot/workspace.js';
const repo=fileURLToPath(new URL('../..',import.meta.url)),arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const python=arg('--python')||process.env.IBM_PLOT_TEST_PYTHON;if(!python)throw Error('Set IBM_PLOT_TEST_PYTHON or --python');
const native=JSON.parse(await readFile(arg('--native-report')||resolve(repo,'../../work/plot-p1-1793454948275/report.json'),'utf8'));
const root=arg('--output')||resolve(repo,'../../work/plot-layout-native-'+Date.now());await mkdir(root,{recursive:true});
const handle=await bootLite({storageRoot:join(root,'storage'),coreConfig:{projectsRoot:join(root,'projects')},includePython:false});
try{
 await handle.ctx.ibmCore.createProject({id:'layout-native',name:'原生成图与图片组合验收'});const service=handle.ctx.labPlotRecords,runtime=handle.ctx.ibmRuntime,actual=runtime.plot.bind(runtime),calls=[];runtime.mcpConfig=()=>({command:python,cwd:root});runtime.plot=(project,action,args,opts)=>{calls.push(action);if(!['image','layout'].includes(action))throw Error('Unexpected Origin call');return actual(project,action,args,opts);};
 const ids=[],sourceHashes=[];const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const name of ['line','scatter','bar','box']){
  const entry=native.find(row=>row.case===name&&row.ok&&row.pixelEqualAfterReopen);if(!entry)throw Error('Missing verified native case '+name);
  const id='source-'+name,folder=await service.plotDirectory('layout-native',id);const copy=async(source,fileName)=>{const bytes=await readFile(source),path=join(folder,fileName);await writeFile(path,bytes);sourceHashes.push({path:source,sha256:hash(bytes)});return {path,fileName,byteLength:bytes.length,sha256:hash(bytes)};};
  const preview=await copy(entry.preview,'figure.png'),pdf=await copy(join(dirname(entry.preview),'figure.pdf'),'figure.pdf'),origin=await copy(entry.origin,'figure.opju');await service.create({id,projectId:'layout-native',topic:'Origin '+name});await service.update(id,{workflow:{version:1,revision:1,status:'completed',stage:'已验证原生成图',headerRow:0,raw:preview,spec:plotSpecSchema.parse({kind:name,yCols:[0]}),saved:{preview,pdf,origin}}});ids.push(id);
 }
 for(const name of ['quadrants.png','quadrants.tiff']){const bytes=await readFile(join(repo,'tests/fixtures/plot-images',name));const {record}=await service.plotUpload({projectId:'layout-native',name,base64:bytes.toString('base64')});ids.push(record.id);}
 let {record}=await service.plotLayoutCreate({projectId:'layout-native',ids,name:'Origin 与 PNG TIFF 混排'});const doc=structuredClone(record.layout.doc);doc.page.h=140;
 ({record}=await service.plotLayoutSave({projectId:'layout-native',id:record.id,revision:record.layout.revision,doc,dpi:300}));
 const check=await promisify(execFile)(python,['-I','-c',"from PIL import Image;import pymupdf as p,sys,json;im=Image.open(sys.argv[1]);t=Image.open(sys.argv[2]);assert im.tobytes()==t.tobytes();d=p.open(sys.argv[3]);page=d[0];assert abs(page.rect.width-180/25.4*72)<.01;assert abs(page.rect.height-140/25.4*72)<.01;assert '(f)' in page.get_text();assert len(page.get_drawings())>0;print(json.dumps({'size':list(im.size),'vectorPaths':len(page.get_drawings()),'textCharacters':len(page.get_text()),'pngTiffPixelEqual':True}))",record.layout.saved.png.path,record.layout.saved.tiff.path,record.layout.saved.pdf.path]);
 for(const file of sourceHashes)if(hash(await readFile(file.path))!==file.sha256)throw Error('Native source changed');
 const report={ok:true,recordId:record.id,sourceCount:ids.length,sourceHashes,originCalls:0,calls,verification:JSON.parse(check.stdout),artifacts:record.layout.saved};await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,report:join(root,'report.json'),...report.verification,artifacts:report.artifacts},null,2));
}finally{await handle.dispose();}
