import {createHash} from 'node:crypto';
import {normalizeDoi} from './search-engine.js';
export const RIS_MAX_BYTES=2*1024*1024;
export function decodeRis(bytes){
 if(!bytes.length||bytes.length>RIS_MAX_BYTES)throw Error('RIS 文件不能为空且不能超过 2 MB');
 let encoding='utf-8',offset=0;
 if(bytes[0]===255&&bytes[1]===254){encoding='utf-16le';offset=2;}
 else if(bytes[0]===254&&bytes[1]===255){encoding='utf-16be';offset=2;}
 try{return {text:new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(offset)),encoding};}
 catch{if(encoding!=='utf-8')throw Error('RIS 文件编码无效');return {text:new TextDecoder('gb18030',{fatal:true}).decode(bytes),encoding:'gb18030'};}
}
export function parseRis(text){
 const records=[];let row,lastTag;
 for(const [index,line] of String(text).replace(/^\uFEFF/,'').split(/\r\n|\n|\r/).entries()){
  if(!line.trim())continue;
  const tag=line.match(/^([A-Z0-9]{2})[ \t]+-[ \t]?(.*)$/);
  if(tag){const [,name,value]=tag;
   if(name==='TY'){if(row)throw Error(`RIS 第 ${index+1} 行：上一条记录缺少 ER`);row={TY:[value]};lastTag='TY';}
   else if(name==='ER'){if(!row)throw Error(`RIS 第 ${index+1} 行：ER 前缺少 TY`);records.push(row);row=null;lastTag=null;}
   else{if(!row)throw Error(`RIS 第 ${index+1} 行：字段不在 TY/ER 记录中`);(row[name]??=[]).push(value);lastTag=name;}
  }else if(row&&lastTag&&(/^[ \t]/.test(line)||['AB','N2','TI','T1','CT'].includes(lastTag))){row[lastTag][row[lastTag].length-1]+=' '+line.trim();}
  else throw Error(`RIS 第 ${index+1} 行格式无效`);
 }
 if(row)throw Error('RIS 最后一条记录缺少 ER');
 if(!records.length)throw Error('未找到 RIS 文献记录（需要 TY / ER 标签）');
 if(records.length>3000)throw Error('单次最多导入 3000 条 RIS 文献');
 const results=[],seen=new Set();
 for(const [index,row] of records.entries()){
  const first=(...tags)=>tags.flatMap(tag=>row[tag]??[]).find(value=>value.trim())?.trim();
  const title=first('TI','T1','CT');if(!title)throw Error(`RIS 第 ${index+1} 条文献缺少标题 TI/T1`);
  const doi=normalizeDoi(first('DO'));const year=Number(first('PY','Y1','DA')?.match(/\d{4}/)?.[0])||undefined;
  const identity=doi??title.toLowerCase().replace(/\s+/g,' ')+'|'+(year??'');
  if(seen.has(identity))continue;seen.add(identity);
  const url=(row.UR??[]).find(value=>/^https?:\/\//i.test(value.trim()));
  const start=first('SP'),end=first('EP');
  results.push({id:'ris-'+createHash('sha256').update(identity).digest('hex').slice(0,20),title,doi,authors:[...new Set([...(row.AU??[]),...(row.A1??[])])],year,journal:first('JO','JF','JA','T2'),volume:first('VL'),issue:first('IS'),pages:start?(end&&end!==start?start+'-'+end:start):undefined,abstract:first('AB','N2'),type:first('TY'),landingUrl:url?.trim(),source:'ris',sources:['ris'],pdfStatus:'unavailable',shortDescriptionZh:'摘要待提炼'});
 }
 return {results,recordCount:records.length,duplicateCount:records.length-results.length};
}
