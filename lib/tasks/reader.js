import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {paperSourceBundleSchema} from '../../src/task-models.js';

const script=fileURLToPath(new URL('../../scripts/runtime/reader_source.py',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const now=()=>new Date().toISOString();
const atomicJson=async(path,value)=>{const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value));await rename(temp,path);};
const publicTranslation=row=>row?Object.fromEntries(Object.entries(row).filter(([key])=>key!=='directory')):undefined;
const translatable=block=>['text','scan','figure-text'].includes(block.kind);
const reviewHash=(data,group)=>hash(Buffer.from(JSON.stringify(group.ids.map(id=>data.translations[id]??null))));
const needsReview=(data,block)=>{const group=(data.continuityGroups??[]).find(g=>g.id===block.continuationGroup);return group&&data.continuityReviews?.[group.id]!==reviewHash(data,group);};
async function runPython(service,args,jobId){
 const resolved=await service.executor.resolvePython();if(!resolved.command)throw Error('PDF 解析需要科研 Python');
 return service.ctx.ibmRuntime.track(()=>new Promise((resolve,reject)=>{
  const child=service.executor.spawnImpl(resolved.command[0],[...resolved.command.slice(1),'-I',script,...args],{windowsHide:true});
  if(jobId){service.readerProcessing??=new Map();service.readerProcessing.set(jobId,child);}
  let stdout='',stderr='',bytes=0;const timer=setTimeout(()=>{child.kill();reject(Error('PDF 处理超时'));},180000);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>150*1024*1024){child.kill();reject(Error('SI 输出过大'));}else stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1500);});
  child.once('error',error=>{clearTimeout(timer);if(jobId)service.readerProcessing.delete(jobId);reject(error);});
  child.once('close',code=>{clearTimeout(timer);if(jobId)service.readerProcessing.delete(jobId);if(code!==0)return reject(Error(stderr||'PDF 处理失败'));try{resolve(JSON.parse(stdout));}catch{reject(Error('PDF 处理返回无效数据'));}});
 }));
}
export const readerMethods={
 async readerResume(){
  for(const id of this.table('bundles').keys()){const bundle=this.table('bundles').get(id);for(const row of bundle.translations??[])if(['queued','running'].includes(row.status))await this.translationStore(bundle,{...row,status:'failed',stage:'应用已重启，可继续翻译',error:'保留已翻译块，点击翻译恢复',updatedAt:now()});}
  this.ctx.on('session/event',(session,event)=>{if(event.type!=='turn/end')return;void this.readerTurnEnded(session.header.id).catch(()=>{});},{global:true});
  this.ctx.effect(()=>()=>this.readerLeases?.clear(),'iBM 阅读文件会话清理');
 },
 async readerTurnEnded(sessionId){
  for(const id of this.table('bundles').keys()){const bundle=this.table('bundles').get(id);for(const row of bundle.translations??[])if(row.sessionId===sessionId&&['queued','running'].includes(row.status))await this.withFolderLock(bundle.projectId,async()=>{const fresh=this.table('bundles').get(id),current=fresh?.translations?.find(x=>x.id===row.id);if(current&&['queued','running'].includes(current.status))await this.translationStore(fresh,{...current,status:'failed',stage:'Agent 本轮结束，全文尚未完成',error:'可点击翻译恢复剩余段落',updatedAt:now()});});}
 },
 readerBundle({projectId,bundleId,kind='pdf'}){
  this.ctx.ibmCore.requireProject(projectId);const bundle=this.table('bundles').get(bundleId);
  if(!bundle||bundle.projectId!==projectId)throw Error('文献不存在或不属于当前课题');
  if(!['pdf','si'].includes(kind))throw Error('文献材料类型无效');return bundle;
 },
 async readerOpen(request){
  const bundle=this.readerBundle(request),kind=request.kind??'pdf';
  let file=await this.ctx.ibmCore.bundleFile(bundle.id,kind);
  if(request.translationId){file=await this.withFolderLock(request.projectId,async()=>{const {bundle:owned,row}=this.translationFind(request);if(row.status!=='completed')throw Error('译文尚未完成');if(hash(file.buffer)!==row.sourceSha256)throw Error('源 PDF 已更新，请重新翻译');return this.readerCompose(owned,row);});}
  if(file.buffer.length>200*1024*1024)throw Error('阅读器支持 200 MB 内的材料');
  const translation=request.translationId?this.translationFind(request).row:(bundle.translations??[]).filter(row=>row.kind===kind&&row.sourceSha256===hash(file.buffer)).at(-1);
  const result={title:bundle.title??file.fileName,fileName:file.fileName,bytes:file.buffer.length,sha256:hash(file.buffer),translation:publicTranslation(translation),completedTranslation:publicTranslation(request.translationId?translation:(bundle.translations??[]).filter(row=>row.kind===kind&&row.status==='completed'&&row.sourceSha256===hash(file.buffer)).at(-1))};
  if(!file.buffer.subarray(0,4).equals(Buffer.from('%PDF'))){
   if(/\.zip$/i.test(file.fileName))return {...result,format:'zip',...await runPython(this,['zip-list',bundle.siPath])};
   return {...result,format:'unsupported'};
  }
  this.readerLeases??=new Map();for(const [id,row]of this.readerLeases)if(row.expires<Date.now())this.readerLeases.delete(id);
  while(this.readerLeases.size>=4||[...this.readerLeases.values()].reduce((sum,row)=>sum+row.buffer.length,0)+file.buffer.length>256*1024*1024){if(!this.readerLeases.size)break;this.readerLeases.delete(this.readerLeases.keys().next().value);}
  const lease=randomUUID();this.readerLeases.set(lease,{projectId:bundle.projectId,bundleId:bundle.id,buffer:file.buffer,expires:Date.now()+3600000});
  return {...result,format:'pdf',lease};
 },
 readerChunk(request){
  this.readerBundle(request);const row=this.readerLeases?.get(request.lease);
  if(!row||row.projectId!==request.projectId||row.bundleId!==request.bundleId||row.expires<Date.now())throw Error('阅读会话已过期，请重新打开文献');
  const offset=request.offset??0,length=request.length??262144;
  if(!Number.isSafeInteger(offset)||offset<0||offset>row.buffer.length||!Number.isSafeInteger(length)||length<1||length>262144)throw Error('文献读取范围无效');
  row.expires=Date.now()+3600000;return {base64:row.buffer.subarray(offset,offset+length).toString('base64')};
 },
 readerClose(request){this.readerBundle(request);const row=this.readerLeases?.get(request.lease);if(row?.projectId===request.projectId&&row.bundleId===request.bundleId)this.readerLeases.delete(request.lease);return {closed:true};},
 async readerAsset({group,name}){
  if(!['cmaps','standard_fonts'].includes(group)||! /^[A-Za-z0-9_-]+\.(bcmap|pfb|ttf)$/.test(name??''))throw Error('字体资源无效');
  const bytes=await readFile(fileURLToPath(new URL(`../../client/vendor/pdfjs/${group}/${name}`,import.meta.url)));return {base64:bytes.toString('base64')};
 },
 async readerZipPdf(request){const bundle=this.readerBundle(request);if(request.kind!=='si'||!/\.zip$/i.test(bundle.siPath??'')||!Number.isInteger(request.index)||request.index<0)throw Error('SI 文件选择无效');return runPython(this,['zip-pdf',bundle.siPath,String(request.index)]);},
 async readerCompose(bundle,row){
  const content=await readFile(join(row.directory,'reader.json'));if(hash(content)!==row.resultSha256)throw Error('归档译文已变更，无法通过完整性校验');
  const original=await readFile(join(row.directory,'original.pdf'));if(hash(original)!==row.sourceSha256)throw Error('翻译源文件完整性校验失败');
  if(row.pdfSha256&&row.pdfLayoutVersion===3){const buffer=await readFile(join(row.directory,'translated.pdf'));if(hash(buffer)!==row.pdfSha256)throw Error('中文 PDF 已变更，无法通过完整性校验');return {buffer,fileName:basename(bundle[row.kind==='si'?'siPath':'pdfPath']??'paper.pdf').replace(/\.pdf$/i,'')+'-中文.pdf'};}
  const layout=await runPython(this,['compose',join(row.directory,'original.pdf'),row.directory],row.id),buffer=await readFile(join(row.directory,'translated.pdf'));
  if(buffer.length>200*1024*1024||!buffer.subarray(0,4).equals(Buffer.from('%PDF')))throw Error('中文 PDF 输出无效或超过 200 MB');
  await this.translationStore(bundle,{...row,pdfSha256:hash(buffer),pdfLayoutVersion:layout.layoutVersion,pdfWarnings:layout.warnings,updatedAt:now()});
  return {buffer,fileName:basename(bundle[row.kind==='si'?'siPath':'pdfPath']??'paper.pdf').replace(/\.pdf$/i,'')+'-中文.pdf'};
 },
 async readerTranslationFile(request){return this.withFolderLock(request.projectId,async()=>{const {bundle,row}=this.translationFind(request);if(row.status!=='completed')throw Error('译文尚未完成');const source=await this.ctx.ibmCore.bundleFile(bundle.id,row.kind);if(hash(source.buffer)!==row.sourceSha256)throw Error('源 PDF 已更新，请重新翻译');const file=await this.readerCompose(bundle,row);return {...file,mime:'application/pdf',byteLength:file.buffer.length,sha256:hash(file.buffer)};});},
 async translationCreate(request){return this.withFolderLock(request.projectId,async()=>{
  let bundle=this.readerBundle(request);const kind=request.kind??'pdf',file=await this.ctx.ibmCore.bundleFile(bundle.id,kind);
  if(!file.buffer.subarray(0,4).equals(Buffer.from('%PDF')))throw Error('请先归档 PDF，再启动翻译');
  const sourceSha256=hash(file.buffer),prior=(bundle.translations??[]).filter(row=>row.kind===kind&&row.sourceSha256===sourceSha256).at(-1);
  if(prior&&['queued','running','completed'].includes(prior.status)&&!(request.improve&&prior.status==='completed'))return {translation:publicTranslation(prior),reused:true};
  const improved=Boolean(request.improve&&prior?.status==='completed');
  bundle=await this.ensureBundleEntryLayout(bundle);const id=improved?'translation-'+randomUUID():prior?.id??'translation-'+randomUUID(),directory=improved?join(bundle.entryDir,'translations',id):prior?.directory??join(bundle.entryDir,'translations',id);
  await mkdir(directory,{recursive:true});await writeFile(join(directory,'original.pdf'),file.buffer);
  if(improved){await this.translationRead({...request,translationId:prior.id,limit:1});const bytes=await readFile(join(prior.directory,'reader.json'));await atomicJson(join(directory,'draft.json'),{translations:JSON.parse(bytes).translations});}
  const row={...(improved?{}:prior),id,kind,sourceSha256,directory,status:'queued',stage:'等待 Agent 开始翻译',createdAt:improved?now():prior?.createdAt??now(),updatedAt:now(),error:undefined};
  await this.translationStore(bundle,row);return {translation:publicTranslation(row),reused:false};
 });},
 async translationStore(bundle,row){
  const fresh=this.table('bundles').get(bundle.id);if(!fresh)throw Error('文献已被删除');
  await this.table('bundles').put(bundle.id,paperSourceBundleSchema.parse({...fresh,translations:[...(fresh.translations??[]).filter(x=>x.id!==row.id),row],updatedAt:now()}));
  const status=row.status==='running'?'running':row.status==='queued'?'queued':row.status;
  this.ctx.ibmCore.activity.update('translation:'+row.id,{projectId:bundle.projectId,kind:'translation',label:'文献全文翻译',status,stage:row.stage,percent:row.totalBlocks?Math.floor((row.completedBlocks??0)/row.totalBlocks*100):null});
 },
 translationFind(request){const bundle=this.readerBundle(request),row=(bundle.translations??[]).find(x=>x.id===request.translationId);if(!row||row.kind!==(request.kind??'pdf'))throw Error('翻译任务不存在或材料不匹配');return {bundle,row};},
 async translationBind(request){return this.withFolderLock(request.projectId,async()=>{const {bundle,row}=this.translationFind(request);if(this.ctx.ibmCore.getProjectBySession(request.sessionId)?.project.id!==request.projectId)throw Error('翻译会话不属于当前课题');if(row.status!=='queued')throw Error('翻译任务不在等待启动状态');await this.translationStore(bundle,{...row,sessionId:request.sessionId,updatedAt:now()});return {bound:true};});},
 async translationPrepare(request){
  const {row}=this.translationFind(request);if(row.status==='completed')return this.translationRead(request);
  return this.withFolderLock(request.projectId,async()=>{
   const {bundle,row:fresh}=this.translationFind(request);if(fresh.status==='cancelled')throw Error('任务已取消，请点击重试');
   await this.translationStore(bundle,{...fresh,sessionId:request.sessionId??fresh.sessionId,status:'running',stage:'正在解析 PDF 页面',updatedAt:now()});
   try{const source=await runPython(this,['extract',join(row.directory,'original.pdf'),row.directory],row.id);const data=JSON.parse(await readFile(join(row.directory,'source.json'),'utf8'));
    if(!data.blocks.some(translatable))throw Error('PDF 没有可翻译页面');
    let previous={};try{previous=JSON.parse(await readFile(join(row.directory,'draft.json'),'utf8'));}catch{}
    const draft={...data,translations:previous.translations??{},continuityReviews:previous.continuityReviews??{}};await atomicJson(join(row.directory,'draft.json'),draft);
    const updated={...fresh,sessionId:request.sessionId??fresh.sessionId,status:'running',stage:'正在翻译全文',pageCount:source.pageCount,totalBlocks:data.blocks.filter(translatable).length,completedBlocks:Object.keys(draft.translations).length,updatedAt:now()};
    await this.translationStore(bundle,updated);return {translation:publicTranslation(updated),scannedPages:data.scannedPages,instructions:'连续片段结合 context 与 continuation 整段理解并同批提交 reviewedGroups 联合复核；figure-text 为图片 OCR 文字，核对 imagePath 后翻译，低置信度写 note。逐块完整翻译；保留数字、化学式、公式和引用编号。scan 块需读取 imagePath 图像转写英文并翻译，不得把全文概括成摘要。分批调用读取/写入工具，所有文本块完成后调用 finish。'};
   }catch(error){await this.translationStore(bundle,{...fresh,status:'failed',stage:'解析失败',error:error.message,updatedAt:now()});throw error;}
  });
 },
 async translationRead(request){
  const {row}=this.translationFind(request);const path=join(row.directory,row.status==='completed'?'reader.json':'draft.json');
  if(row.status==='queued')return {translation:publicTranslation(row),total:0,blocks:[]};
  const bytes=await readFile(path);if(row.status==='completed'&&hash(bytes)!==row.resultSha256)throw Error('归档译文已变更，无法通过完整性校验');
  const data=JSON.parse(bytes);const pending=request.pendingOnly?data.blocks.filter(block=>translatable(block)&&(!data.translations[block.id]||needsReview(data,block))):data.blocks;
  const offset=request.offset??0,limit=request.limit??8;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40)throw Error('翻译读取范围无效');
  let selected=pending.slice(offset,offset+limit);if(request.pendingOnly){let characters=0;selected=selected.filter(block=>{if(characters>=5000)return false;characters+=(block.original??'').length;return true;});}
  const texts=data.blocks.filter(b=>b.kind==='text');
  return {translation:publicTranslation(row),pageCount:data.pageCount,total:pending.length,blocks:selected.map(block=>{const index=texts.findIndex(b=>b.id===block.id),group=(data.continuityGroups??[]).find(g=>g.id===block.continuationGroup);return {...block,...data.translations[block.id],imagePath:block.image?join(row.directory,block.image):undefined,context:block.kind==='text'?{before:texts[index-1]?.original?.slice(-1200),after:texts[index+1]?.original?.slice(0,1200)}:undefined,continuation:group?{...group,original:group.original.slice(0,12000),fragments:group.ids.map(id=>{const source=data.blocks.find(b=>b.id===id);return {id,page:source.page,original:source.original,...data.translations[id]};}),needsReview:needsReview(data,block)}:undefined};})};
 },
 async translationWrite(request){return this.withFolderLock(request.projectId,async()=>{
  const {bundle,row}=this.translationFind(request);if(row.status!=='running')throw Error('任务未运行，请先 prepare 或重试');
  if(!Array.isArray(request.blocks)||!request.blocks.length||request.blocks.length>40)throw Error('每批需提交 1–40 个翻译块');
  const data=JSON.parse(await readFile(join(row.directory,'draft.json'),'utf8'));
  for(const input of request.blocks){const source=data.blocks.find(x=>x.id===input.id);if(!source||!translatable(source))throw Error('翻译块编号无效');
   if(typeof input.zh!=='string'||!input.zh.trim()||input.zh.length>30000)throw Error('中文译文为空或过长');
   if(source.kind==='scan'&&(!input.original?.trim()||input.original.length>30000))throw Error('扫描页面必须提供完整原文转写');
   data.translations[input.id]={zh:input.zh.trim(),...(['scan','figure-text'].includes(source.kind)&&input.original?{original:input.original}:{}),...(input.note?{note:String(input.note).slice(0,3000)}:{})};
  }
  if(request.reviewedGroups){if(!Array.isArray(request.reviewedGroups)||request.reviewedGroups.length>20)throw Error('连续段落复核编号无效');data.continuityReviews??={};for(const id of request.reviewedGroups){const group=(data.continuityGroups??[]).find(g=>g.id===id);if(!group||!group.ids.every(part=>request.blocks.some(b=>b.id===part)))throw Error('复核跨栏/跨页段落时必须同批提交全部片段译文');data.continuityReviews[id]=reviewHash(data,group);}}
  await atomicJson(join(row.directory,'draft.json'),data);const completedBlocks=data.blocks.filter(block=>translatable(block)&&data.translations[block.id]?.zh).length;
  const reviewCount=new Set(data.blocks.filter(block=>needsReview(data,block)).map(block=>block.continuationGroup)).size;const remaining=data.blocks.filter(block=>translatable(block)&&(!data.translations[block.id]?.zh||needsReview(data,block))).length;
  const updated={...row,completedBlocks,stage:reviewCount?`正在联合复核连续段落（${reviewCount} 组）`:`正在翻译全文（${completedBlocks}/${row.totalBlocks} 段）`,updatedAt:now()};await this.translationStore(bundle,updated);return {translation:publicTranslation(updated),remaining};
 });},
 async translationFinish(request){return this.withFolderLock(request.projectId,async()=>{
  const {bundle,row}=this.translationFind(request);if(row.status==='completed')return {translation:publicTranslation(row)};if(row.status!=='running')throw Error('任务未运行');
  const data=JSON.parse(await readFile(join(row.directory,'draft.json'),'utf8'));const missing=data.blocks.filter(block=>translatable(block)&&!data.translations[block.id]?.zh);if(missing.length)throw Error(`仍有 ${missing.length} 个文本块未翻译，不能登记为完成`);
  if(data.blocks.some(block=>needsReview(data,block)))throw Error('跨栏/跨页连续段落尚未联合复核，请同批写入片段并提交 reviewedGroups');
  const current=await this.ctx.ibmCore.bundleFile(bundle.id,row.kind);if(hash(current.buffer)!==row.sourceSha256)throw Error('源 PDF 已更新，请重新翻译');
  const content=JSON.stringify({...data,sourceSha256:row.sourceSha256,notes:request.notes??''});await atomicJson(join(row.directory,'reader.json'),JSON.parse(content));
  await writeFile(join(row.directory,'paper.md'),data.blocks.map(block=>block.kind==='image'?`![图表（第 ${block.page} 页）](${block.image})`:`<!-- ${block.id} / page ${block.page} -->\n**Original:**\n${data.translations[block.id]?.original??block.original}\n\n**中文:**\n${data.translations[block.id]?.zh??''}`).join('\n\n'));
  await writeFile(join(row.directory,'translation_notes.md'),request.notes??'');
  await atomicJson(join(row.directory,'source_map.json'),{schemaVersion:1,sourceSha256:row.sourceSha256,pageCount:data.pageCount,blocks:data.blocks.map(block=>({id:block.id,page:block.page,kind:block.kind,image:block.image,bbox:block.bbox,confidence:block.confidence,continuationGroup:block.continuationGroup}))});
  const prepared={...row,resultSha256:hash(Buffer.from(content)),stage:'正在生成中文 PDF',updatedAt:now()};await this.translationStore(bundle,prepared);
  try{await this.readerCompose(bundle,prepared);}catch(error){await this.translationStore(bundle,{...prepared,status:'failed',stage:'PDF 排版失败，译文已保存',error:error.message,updatedAt:now()});throw error;}
  const composed=this.translationFind(request).row;
  const updated={...composed,status:'completed',stage:'中文 PDF 归档完成',completedBlocks:row.totalBlocks,notes:String(request.notes??'').slice(0,5000),updatedAt:now()};await this.translationStore(bundle,updated);return {translation:publicTranslation(updated)};
 });},
 async translationCancel(request){this.translationFind(request);this.readerProcessing?.get(request.translationId)?.kill();return this.withFolderLock(request.projectId,async()=>{const {bundle,row}=this.translationFind(request);if(row.status==='completed')throw Error('已完成译文不能取消');const updated={...row,status:'cancelled',stage:'翻译已取消',updatedAt:now()};await this.translationStore(bundle,updated);return {translation:publicTranslation(updated)};});},
 async translationImage(request){const {row}=this.translationFind(request);if(!/^p\d+-(b\d+|v\d+|scan)\.png$/.test(request.name??''))throw Error('图像引用无效');const bytes=await readFile(join(row.directory,request.name));return {base64:bytes.toString('base64')};},
};
