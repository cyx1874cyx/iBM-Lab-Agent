import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {join,basename,isAbsolute,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseReagentWorkbook} from './workbook.js';

export const REAGENT_KINDS={chemical:'化学试剂',biological:'生物试剂',cells:'细胞'};
const normalized=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[‐‑‒–—−]/g,'-').replace(/\s+/g,' ').trim();
const sourcePath=path=>{if(typeof path!=='string'||!isAbsolute(path)||extname(path).toLowerCase()!=='.xlsx')throw Error('请选择本机 .xlsx 清单文件');return path;};

/** Global lab catalog. Workbooks remain the sole data source; no stock is inferred. */
export class ReagentCatalog{
 constructor(root){this.root=root;this.configPath=join(root,'sources.json');this.cache=new Map();}
 async config(){try{const data=JSON.parse(await readFile(this.configPath,'utf8'));if(!Array.isArray(data.sources))throw Error('清单来源配置无效');return data.sources.filter(row=>Object.hasOwn(REAGENT_KINDS,row.id)).map(row=>({id:row.id,path:sourcePath(row.path)}));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
 async setSource(id,path){
  if(!Object.hasOwn(REAGENT_KINDS,id))throw Error('未知清单类型');sourcePath(path);
  await this.readSource({id,path},true); // Validate before replacing a working source.
  const sources=await this.config(),next=[...sources.filter(row=>row.id!==id),{id,path}];
  await mkdir(this.root,{recursive:true});const temporary=join(this.root,`sources-${randomUUID()}.tmp`);
  await writeFile(temporary,JSON.stringify({version:1,sources:next},null,2),'utf8');await rename(temporary,this.configPath);
  return {configured:true};
 }
 async readSource(source,force=false){
  const info=await stat(source.path);if(!info.isFile()||!info.size||info.size>25*1024*1024)throw Error('清单为空或超过 25 MB');
  const fingerprint=`${source.path}:${info.mtimeMs}:${info.size}`,old=this.cache.get(source.id);
  if(!force&&old?.fingerprint===fingerprint)return old;
  const parsed=await parseReagentWorkbook(await readFile(source.path),{id:source.id,kind:source.id,fileName:basename(source.path)});
  const next={...parsed,fingerprint,path:source.path,modifiedAt:info.mtime.toISOString(),loadedAt:new Date().toISOString()};
  next.records=next.records.map(row=>({...row,search:normalized([row.name,row.cas,row.catalogNumber,row.spec,row.brand,row.location,row.fileName,row.sheet,REAGENT_KINDS[row.kind],...row.fields.map(f=>f.value)].join(' '))}));
  this.cache.set(source.id,next);return next;
 }
 async source(id){const source=(await this.config()).find(s=>s.id===id);if(!source)throw Error('尚未关联该清单');await stat(source.path);return source;}
 async search(request={}){
  const configured=await this.config(),records=[],sources=[];
  for(const [id,label] of Object.entries(REAGENT_KINDS)){
   const source=configured.find(s=>s.id===id);if(!source){sources.push({id,label,configured:false,count:0});continue;}
   let data,error;
   try{data=await this.readSource(source,request.refresh===true);}catch(reason){error=reason.code==='ENOENT'?'清单文件不存在，请重新关联':reason.code==='EACCES'?'无权读取清单，请检查文件权限':reason.message;const cached=this.cache.get(id);if(cached?.path===source.path)data=cached;}
   if(data)records.push(...data.records);
   sources.push({id,label,configured:true,fileName:basename(source.path),path:source.path,count:data?.records.length||0,modifiedAt:data?.modifiedAt,loadedAt:data?.loadedAt,sheets:data?.sheets||[],warnings:data?.warnings||[],error,stale:!!error&&!!data});
  }
  const tokens=normalized(String(request.query||'').slice(0,300)).split(' ').filter(Boolean),kind=Object.hasOwn(REAGENT_KINDS,request.kind)?request.kind:'all';
  const inKind=records.filter(row=>kind==='all'||row.kind===kind),locations=[...new Set(inKind.map(row=>row.location).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  let matches=inKind.filter(row=>(!request.location||row.location===request.location)&&(request.status!=='used'||row.used)&&(request.status!=='unmarked'||!row.used)&&tokens.every(token=>row.search.includes(token)||row.search.replaceAll(' ','').includes(token)));
  if(tokens.length){const query=normalized(request.query);const score=row=>normalized(row.cas)===query||normalized(row.catalogNumber)===query?4:normalized(row.name)===query?3:normalized(row.name).includes(query)?2:1;matches.sort((a,b)=>score(b)-score(a));}
  const limit=Math.max(1,Math.min(100,Number(request.limit)||50)),requested=Math.max(0,Math.floor(Number(request.offset)||0)),offset=matches.length?Math.min(requested,Math.floor((matches.length-1)/limit)*limit):0;
  return {total:matches.length,offset,limit,records:matches.slice(offset,offset+limit).map(({search,...row})=>row),sources,locations,counts:{all:records.length,...Object.fromEntries(Object.keys(REAGENT_KINDS).map(id=>[id,records.filter(row=>row.kind===id).length]))},checkedAt:new Date().toISOString()};
 }
}
