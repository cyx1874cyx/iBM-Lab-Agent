import {readFile,stat} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeDoi} from './doi.js';
import {validateReadingFolderName} from './folder.js';

const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readingTransferRequested(value){
 const text=String(value??'');
 if(/(?:不要|别|不用|暂不|不需要|不必|先不).{0,16}(?:添加|加入|导入|移动|创建|新建|建|整理)/u.test(text))return false;
 return /(?:添加|加入|放入|归入|导入|放到|移到|转到|整理到|收录|收藏|保存到|新建|创建|建个|建一|add|import|save)/iu.test(text)&&/(?:精读|条目|文件夹|reading|folder)/iu.test(text);
}
export function transferAuthorized(chat){
 return readingTransferRequested(chat?.question)||Boolean(chat?.previousTransferRequest&&/^(?:好[的]?|可以|确认|执行|按这个做|按你说的做|就这样做|继续)[吧。！!\s]*$/u.test(String(chat?.question??'').trim()));
}

/** Resolve stable paper identities from selected catalogs, never from model-supplied paths. */
export async function addKnowledgeToReading(knowledge,tasks,{projectId,sessionId,paperRefs,folderName},{signal}={}){
 const {chat}=await knowledge.chatState({projectId,sessionId});
 if(!chat||!transferAuthorized(chat))throw Error('请先在知识库对话中明确要求将指定文献加入精读文件夹');
 if(!Array.isArray(paperRefs)||!paperRefs.length||paperRefs.length>20||paperRefs.some(ref=>typeof ref!=='string'||ref.length>1000))throw Error('每次请选择 1–20 篇文献，使用文献编号、DOI 或 T轮次:S编号');
 folderName=validateReadingFolderName(folderName);signal?.throwIfAborted();
 const groups=await knowledge.selected(projectId,chat.settings.keys),documents=[];
 for(const [service,bases]of groups)for(const base of bases){const catalog=JSON.parse(await readFile(join(service.catalogsPath,base.id+'.json'),'utf8'));for(const document of catalog.documents)documents.push({...document,service,libraryKey:base.key});}
 const identity=row=>normalizeDoi(row.literature?.doi)||`${row.libraryKey}:${clean(row.literature?.paperId)||clean(row.literature?.title)||row.sourceId}`;
 const targets=[];
 for(const raw of new Set(paperRefs)){
  const ref=raw.trim(),citation=/^T?(\d+)\s*:\s*(S\d+)$/iu.exec(ref);
  let matches;
  if(citation){const source=chat.retrievals?.find(item=>item.turn===Number(citation[1]))?.result?.sources.find(item=>item.citationId===citation[2].toUpperCase());matches=source?documents.filter(row=>row.sourceId===source.sourceId&&row.libraryKey===source.libraryKey):[];}
  else matches=documents.filter(row=>clean(row.literature?.paperId)===clean(ref)||row.sourceId===ref||(normalizeDoi(ref)&&normalizeDoi(row.literature?.doi)===normalizeDoi(ref))||clean(row.literature?.title)===clean(ref));
  if(!matches.length)throw Error(`未在当前所选知识库中找到 ${ref}，请核对编号；不会用其他文献替代`);
  const ids=[...new Set(matches.map(identity))];if(ids.length!==1)throw Error(`${ref} 对应多个知识库中的不同条目，请改用 T轮次:S编号 或来源 sourceId 明确指定`);
  const target=matches[0],doi=normalizeDoi(target.literature?.doi),paperId=target.literature?.paperId;
  const related=documents.filter(row=>doi?normalizeDoi(row.literature?.doi)===doi:row.libraryKey===target.libraryKey&&(paperId?row.literature?.paperId===paperId:row.sourceId===target.sourceId));
  const title=target.literature?.title?.trim();if(!title)throw Error(`${ref} 缺少可确认的论文标题，请先补全文献元数据`);
  const dedup=doi||clean(title);if(!targets.some(item=>item.dedup===dedup))targets.push({ref,title,doi,dedup,literature:target.literature,related});
 }
 // Validate all requested sources before creating a folder or writing entries.
 let totalBytes=0;
 for(const target of targets){
  target.warnings=[];target.files=[];
  const originals=target.related.filter(row=>row.literature?.role==='original'&&extname(row.relativePath).toLowerCase()==='.pdf');
  const supplements=target.related.filter(row=>row.literature?.role==='supplement'&&['.pdf','.docx'].includes(extname(row.relativePath).toLowerCase()));
  if(originals.length>1)target.warnings.push('知识库有多份正文，采用首份，未覆盖其他版本');
  if(supplements.length>1)target.warnings.push('知识库有多份 SI，本次采用首份');
  for(const [kind,document]of [['pdf',originals[0]],['si',supplements[0]]]){
   if(!document)continue;signal?.throwIfAborted();
   const path=await document.service.resolveSource(document.sourceId),info=await stat(path);totalBytes+=info.size;
   if(info.size>100*1024*1024||totalBytes>256*1024*1024)throw Error('所选文献文件过大，请分批加入精读');
   const bytes=await readFile(path);if(digest(bytes)!==document.contentHash)throw Error(`${target.ref} 的源文件已变化，请先用原知识库更新索引`);
   if(extname(path).toLowerCase()==='.pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw Error(`${target.ref} 的 PDF 文件无效`);
   target.files.push({kind,bytes,hash:document.contentHash,extension:extname(path).toLowerCase()});
  }
 }
 const folderCreated=!tasks.listReadingFolders(projectId).some(row=>clean(row.name)===clean(folderName));
 const folder=await tasks.saveReadingFolder({projectId,name:folderName}),entries=[],failed=[];
 for(const target of targets){
  signal?.throwIfAborted();let bundle,report,created=false;
  try{
   bundle=tasks.listBundles(projectId).find(row=>(target.doi&&normalizeDoi(row.doi)===target.doi)||clean(row.title)===clean(target.title));
   report=bundle?tasks.listReadingReports(projectId).find(row=>row.bundleId===bundle.id):null;
   if(!bundle){const value=await tasks.registerPaperMeta({projectId,title:target.title,doi:target.doi,authors:target.literature.authors,year:target.literature.year,sourceType:target.doi?'doi':'publisher'});bundle=value.bundle;report=value.report;created=value.created;}
   if(!report)report=await tasks.ensureReadingEntry(projectId,bundle.id);
   if(!report.sessionId)report=await tasks.bindReadingSession({projectId,reportId:report.id,sessionId});
   if(!bundle.entryStem||!bundle.entryDir)bundle=await tasks.ensureBundleEntryLayout(bundle);
   await tasks.classifyReadingReport({projectId,reportId:report.id,folderId:folder.id,source:'human',reason:'用户在知识库对话中指定加入精读文件夹'});
   const patch={};
   for(const file of target.files){
    const field=file.kind==='pdf'?'pdfPath':'siPath',hashField=file.kind==='pdf'?'pdfSha256':'siSha256';
    if(bundle[field]){
     let present=false;try{present=(await stat(bundle[field])).isFile();}catch(error){if(error.code!=='ENOENT')throw error;}
     if(present){if(bundle[hashField]!==file.hash)target.warnings.push(`条目已有${file.kind==='pdf'?'正文':'SI'}，保留现有文件`);continue;}
    }
    const fileName=file.kind==='si'?`${bundle.entryStem} SI${file.extension}`:undefined;
    const staged=await tasks.stageFileIntoEntry({projectId,bundleId:bundle.id,kind:file.kind,buffer:file.bytes,fileName});patch[field]=staged.filePath;patch[hashField]=file.hash;
   }
   if(Object.keys(patch).length){bundle={...tasks.getBundle(bundle.id),...patch,...(patch.pdfPath?{acquisitionStatus:'ready',locatorMode:'page-grounded'}:{}),updatedAt:new Date().toISOString()};await knowledge.core.commitSourceBundle(bundle);}
   await tasks.recordProvenance({projectId,kind:'metadata-intake',runId:bundle.id,inputs:{paperId:target.literature.paperId??'',doi:target.doi??'',folderId:folder.id,sourceIds:target.related.map(row=>row.sourceId)},source:'user-requested-knowledge-transfer'});
   entries.push({paperRef:target.ref,title:target.title,bundleId:bundle.id,reportId:report.id,folderId:folder.id,created,hasPdf:Boolean(bundle.pdfPath),hasSi:Boolean(bundle.siPath),warnings:target.warnings});
  }catch(error){failed.push({paperRef:target.ref,error:error.message,...(bundle?{bundleId:bundle.id,reportId:report?.id}: {})});}
  finally{target.files=[];}
 }
 return {ok:failed.length===0,folder,folderCreated,entries,failed,added:entries.filter(row=>row.created).length,reused:entries.filter(row=>!row.created).length,instruction:'只按返回的 entries/failed 报告结果；缺少正文的条目是待补 PDF，未生成或冒充已完成的精读报告。'};
}
