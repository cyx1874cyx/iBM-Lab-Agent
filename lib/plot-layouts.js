import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {layoutDocSchema,layoutSource,gridObjects,outsidePage} from '../src/plot/layout.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const idsOf=ids=>{if(!Array.isArray(ids)||!ids.length||ids.length>60||ids.some(id=>typeof id!=='string'))throw Error('请选择 1–60 张图片');return [...new Set(ids)];};
const panel=(asset,index)=>({id:'panel-'+randomUUID(),type:'panel',assetId:asset.id,x:5,y:5,w:60*asset.width/Math.max(asset.width,asset.height),h:60*asset.height/Math.max(asset.width,asset.height)});
export const plotLayoutMethods={
 async plotLayoutSnapshot(projectId,ids,directory){
  const folder=join(directory,'素材');await mkdir(folder,{recursive:true});const assets=[];
  const copy=async(file,name)=>{const buffer=await readFile(await this.plotSafePath(projectId,file.path));if(buffer.length!==file.byteLength||sha(buffer)!==file.sha256)throw Error('来源图片已被外部修改，请重新保存来源后再添加');const path=join(folder,name);await writeFile(path,buffer,{flag:'wx'});return {path,fileName:name,byteLength:buffer.length,sha256:sha(buffer)};};
  for(const id of idsOf(ids)){
   const source=await this.get(id);if(!source||source.projectId!==projectId||!layoutSource(source))throw Error('来源图片不存在、尚未生成或不属于当前课题');
   const origin=source.workflow?.saved||source.workflow?.draft,image=source.image?.saved.image||source.layout?.saved.png||origin.preview,preview=source.image?.saved.preview||source.layout?.saved.preview||origin.preview;
   const assetId='asset-'+randomUUID(),copied=await copy(image,assetId+'.png'),bytes=await readFile(copied.path);
   if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('图片来源尚未生成有效 PNG 预览，请先保存来源');
   const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height)throw Error('来源图片尺寸无效');
   const thumbnail=preview.sha256===image.sha256?copied:await copy(preview,assetId+'-preview.png');
   const vector=origin?.pdf||source.layout?.saved.pdf;
   assets.push({id:assetId,sourceId:id,title:source.topic,width,height,image:copied,preview:thumbnail,...(vector?{vector:await copy(vector,assetId+'.pdf')}:{})});
  }return assets;
 },
 async plotLayoutOutput(projectId,directory,doc,assets,dpi,signal){
  doc=layoutDocSchema.parse(doc);if(!doc.objects.some(o=>o.type==='panel'))throw Error('版面至少需要一张图片');if(outsidePage(doc).length)throw Error('有对象超出页面，请调整位置、尺寸或增大页面');
  const map=new Map(assets.map(a=>[a.id,a]));for(const object of doc.objects.filter(o=>o.type==='panel'))if(!map.has(object.assetId))throw Error('版面引用了不存在的图片');
  if(![150,300,600].includes(dpi))throw Error('导出分辨率请选择 150、300 或 600 dpi');
  for(const asset of assets){for(const file of [asset.image,asset.vector].filter(Boolean)){const bytes=await readFile(await this.plotSafePath(projectId,file.path));if(bytes.length!==file.byteLength||sha(bytes)!==file.sha256)throw Error('版面素材已被外部修改，原版本已保留');}}
  const runtime=this.ctx.get('ibmRuntime');if(!runtime)throw Error('科学运行环境尚未就绪');
  return runtime.plot(projectId,'layout',{output:join(directory,'版本',randomUUID()),doc,assets,dpi},{signal});
 },
 async plotLayoutCreate({projectId,ids,name='组合版面'}){
  this.ctx.ibmCore.requireProject(projectId);ids=idsOf(ids);const id='plot-'+randomUUID(),directory=await this.plotDirectory(projectId,id),assets=await this.plotLayoutSnapshot(projectId,ids,directory);
  let doc=layoutDocSchema.parse({objects:assets.map(panel)});doc=gridObjects(doc,doc.objects.map(o=>o.id),Math.min(2,assets.length),6);doc=layoutDocSchema.parse(doc);
  const result=await this.plotLayoutOutput(projectId,directory,doc,assets,300),layout={version:1,revision:1,doc,assets,saved:result.saved,savedAt:new Date().toISOString(),dpi:300,history:[]};
  await this.create({id,projectId,topic:String(name).trim().slice(0,160)||'组合版面',source:'layout'});return {record:await this.update(id,{layout,artifactPath:layout.saved.png.path})};
 },
 async plotLayoutSave({projectId,id,revision,doc,dpi=300,name,addIds=[]}){
  this.ctx.ibmCore.requireProject(projectId);const row=await this.get(id);if(!row?.layout||row.projectId!==projectId)throw Error('排版不存在或不属于当前课题');
  if(row.layout.revision!==revision)throw Error('排版已更新，请重新打开');if(this.plotJobs.has(id))throw Error('排版正在保存，请等待完成');doc=layoutDocSchema.parse(doc);
  const controller=new AbortController(),job=Promise.resolve().then(async()=>{
   const directory=await this.plotDirectory(projectId,id),extra=addIds.length?await this.plotLayoutSnapshot(projectId,idsOf(addIds),directory):[],assets=[...row.layout.assets,...extra];
   if(assets.length>100)throw Error('每份版面最多保留 100 个素材版本，请另建版面');
   if(extra.length){const objects=extra.map(panel).map(o=>{const k=Math.min(1,(doc.page.w-2*doc.page.margin)/o.w,(doc.page.h-2*doc.page.margin)/o.h);return {...o,x:doc.page.margin,y:doc.page.margin,w:o.w*k,h:o.h*k};});doc=layoutDocSchema.parse({...doc,objects:[...doc.objects,...objects]});}
   const result=await this.plotLayoutOutput(projectId,directory,doc,assets,dpi,controller.signal);controller.signal.throwIfAborted();if((await this.get(id))?.layout?.revision!==revision)throw Error('排版已更新，请重试');
   const history=[...row.layout.history,{doc:row.layout.doc,saved:row.layout.saved,savedAt:row.layout.savedAt,dpi:row.layout.dpi}].slice(-20),layout={...row.layout,assets,doc,dpi,saved:result.saved,savedAt:new Date().toISOString(),revision:revision+1,history};
   return {record:await this.update(id,{...(typeof name==='string'&&name.trim()?{topic:name.trim().slice(0,160)}:{}),layout,artifactPath:layout.saved.png.path})};
  }).finally(()=>this.plotJobs.delete(id));this.plotJobs.set(id,{job,controller});return job;
 },
 async plotLayoutRestore({projectId,id,revision,index}){
  this.ctx.ibmCore.requireProject(projectId);const row=await this.get(id);if(!row?.layout||row.projectId!==projectId)throw Error('排版不存在或不属于当前课题');if(row.layout.revision!==revision||this.plotJobs.has(id))throw Error('排版正在更新，请重试');
  const version=row.layout.history[index];if(!Number.isInteger(index)||!version)throw Error('历史版面不存在');for(const file of Object.values(version.saved)){const bytes=await readFile(await this.plotSafePath(projectId,file.path));if(bytes.length!==file.byteLength||sha(bytes)!==file.sha256)throw Error('历史版面文件已被外部修改');}
  if((await this.get(id))?.layout?.revision!==revision||this.plotJobs.has(id))throw Error('排版已更新，请重试');
  const current={doc:row.layout.doc,saved:row.layout.saved,savedAt:row.layout.savedAt,dpi:row.layout.dpi};return {record:await this.update(id,{layout:{...row.layout,...version,revision:revision+1,history:[...row.layout.history,current].slice(-20)},artifactPath:version.saved.png.path})};
 },
 async plotLayoutArtifact(row,slot,assetId){
  const file=slot==='layout-asset'?row.layout.assets.find(a=>a.id===assetId)?.preview:row.layout.saved[{preview:'preview','layout-png':'png',pdf:'pdf','layout-tiff':'tiff'}[slot]];if(!file)throw Error('排版文件不存在');
  const buffer=await readFile(await this.plotSafePath(row.projectId,file.path));if(buffer.length!==file.byteLength||sha(buffer)!==file.sha256)throw Error('排版产物已被外部修改');
  const ext=slot==='pdf'?'pdf':slot==='layout-tiff'?'tiff':'png';return {...file,fileName:slot==='layout-asset'?file.fileName:row.topic+'.'+ext,buffer,mime:ext==='pdf'?'application/pdf':ext==='tiff'?'image/tiff':'image/png'};
 },
};
