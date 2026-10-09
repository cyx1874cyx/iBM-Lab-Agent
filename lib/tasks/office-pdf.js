import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {inspectOfficePackage} from '../../src/office-package.js';
import {atomicWrite} from './shared.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validPdf=bytes=>bytes.length>=8&&bytes.subarray(0,5).toString('ascii')==='%PDF-';

// The archived PDF is tied to the exact Office bytes. Reopening it never invokes
// the converter; old artifacts and changed sources regenerate once, on demand.
export async function officePdf(service,tableName,id){
 service.officePdfJobs??=new Map();const key=tableName+':'+id;
 if(service.officePdfJobs.has(key))return service.officePdfJobs.get(key);
 const job=generate(service,tableName,id).finally(()=>service.officePdfJobs.delete(key));
 service.officePdfJobs.set(key,job);return job;
}

async function generate(service,tableName,id){
 const table=service.table(tableName),row=table.get(id);
 if(!row)throw Error('精读或 PPT 记录不存在');
 const kind=tableName==='reports'?'docx':'pptx',sourcePath=row[kind==='docx'?'docxPath':'pptxPath'];
 if(!sourcePath)throw Error('尚未生成 Word 或 PPT 文件');
 const source=await readFile(sourcePath),sourceSha256=hash(source);
 if(row.previewSourceSha256===sourceSha256&&row.previewPdfPath&&row.previewPdfSha256){
  try{const buffer=await readFile(row.previewPdfPath);if(validPdf(buffer)&&hash(buffer)===row.previewPdfSha256)return {buffer,path:row.previewPdfPath,sha256:row.previewPdfSha256,sourceSha256};}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 await inspectOfficePackage(source,kind);
 const renderer=service.ctx.get('officeToPdf');
 if(!renderer?.convert)throw Error('PDF 生成器尚未就绪，Word/PPT 已保存，请稍后重试');
 const result=await renderer.convert({extension:kind,priority:'foreground',source:{
  key:JSON.stringify(['ibm-archive',row.projectId,sourcePath]),version:sourceSha256,bytes:source.length,
  read:async(_signal,maxBytes)=>{if(source.length>maxBytes)throw Error('Word/PPT 文件超过转换容量');return {bytes:source,version:sourceSha256};}
 }},AbortSignal.timeout(120000));
 const buffer=Buffer.from(result.pdf);if(!validPdf(buffer))throw Error('PDF 生成结果无效');
 // Never attach an outdated conversion after replacement/deletion of its source.
 const current=table.get(id);
 if(!current||current[kind==='docx'?'docxPath':'pptxPath']!==sourcePath||hash(await readFile(sourcePath))!==sourceSha256)throw Error('Word/PPT 已更新，请重试生成 PDF');
 const path=sourcePath.replace(/\.(docx|pptx)$/i,'.pdf');
 if(path===sourcePath)throw Error('Word/PPT 文件扩展名无效');
 await atomicWrite(path,buffer);const sha256=hash(buffer);
 await table.put(id,{...table.get(id),previewPdfPath:path,previewPdfSha256:sha256,previewSourceSha256:sourceSha256});
 return {buffer,path,sha256,sourceSha256};
}
