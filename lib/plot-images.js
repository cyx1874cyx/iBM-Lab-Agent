import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {imageEditSchema} from '../src/plot/image.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const plotImageMethods={
 async plotImageUpload(projectId,fileName,buffer){
  const runtime=this.ctx.get('ibmRuntime');if(!runtime)throw Error('科学运行环境尚未就绪');
  const id='plot-'+randomUUID(),directory=await this.plotDirectory(projectId,id),rawDir=join(directory,'原始图片');await mkdir(rawDir);
  const path=join(rawDir,fileName);await writeFile(path,buffer,{flag:'wx'});
  const spec=imageEditSchema.parse({}),result=await runtime.plot(projectId,'image',{path,output:join(directory,'versions',randomUUID()),spec});
  const image={version:1,revision:1,raw:{path,fileName,byteLength:buffer.length,sha256:sha(buffer)},originalPreview:result.saved.preview,width:result.width,height:result.height,format:result.format,warning:result.warning||undefined,spec,saved:result.saved,savedAt:new Date().toISOString()};
  await this.create({id,projectId,topic:fileName.replace(/\.[^.]+$/,''),source:'image-import'});
  return {record:await this.update(id,{image,artifactPath:image.saved.image.path})};
 },
 async plotImageSave({projectId,id,revision,spec}){
  this.ctx.ibmCore.requireProject(projectId);
  const row=await this.get(id);if(!row?.image||row.projectId!==projectId)throw Error('图片条目不存在或不属于当前课题');
  if(row.image.revision!==revision)throw Error('图片已更新，请重新打开后编辑');
  if(this.plotJobs.has(id)||this.plotStarting.has(id))throw Error('图片正在保存，请稍后重试');
  spec=imageEditSchema.parse(spec);
  const controller=new AbortController();
  const job=Promise.resolve().then(async()=>{
   const runtime=this.ctx.get('ibmRuntime');if(!runtime)throw Error('科学运行环境尚未就绪');
   const path=await this.plotSafePath(projectId,row.image.raw.path),bytes=await readFile(path);
   if(bytes.length!==row.image.raw.byteLength||sha(bytes)!==row.image.raw.sha256)throw Error('原始图片已被外部修改，请重新导入');
   const result=await runtime.plot(projectId,'image',{path,output:join(await this.plotDirectory(projectId,id),'versions',randomUUID()),spec},{signal:controller.signal});controller.signal.throwIfAborted();
   const latest=await this.get(id);if(latest?.image?.revision!==revision)throw Error('图片条目已更新，请重试');
   return {record:await this.update(id,{image:{...row.image,spec,saved:result.saved,revision:revision+1,savedAt:new Date().toISOString()},artifactPath:result.saved.image.path})};
  }).finally(()=>this.plotJobs.delete(id));
  this.plotJobs.set(id,{job,controller});return job;
 },
 async plotImageArtifact(row,slot){
  const image=row.image,file=slot==='raw'?image.raw:slot==='preview'?image.saved.preview:slot==='image-source'?image.originalPreview:slot==='image-export'?image.saved.image:null;
  if(!file)throw Error('此图片产物不可用');
  const buffer=await readFile(await this.plotSafePath(row.projectId,file.path));
  if(buffer.length!==file.byteLength||sha(buffer)!==file.sha256)throw Error('图片文件已在外部修改，请核对后重试');
  const mime=slot==='raw'?({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.tif':'image/tiff','.tiff':'image/tiff','.bmp':'image/bmp','.gif':'image/gif'}[extname(file.fileName).toLowerCase()]||'application/octet-stream'):'image/png';
  return {...file,...(slot==='image-export'?{fileName:row.topic+'.png'}:{}),buffer,mime};
 },
};
