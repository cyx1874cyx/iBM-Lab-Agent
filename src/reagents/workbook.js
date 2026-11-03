import JSZip from 'jszip';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {posix} from 'node:path';

const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,trimValues:false});
const list=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const clean=value=>String(value??'').replace(/\r/g,'').trim();
const rich=value=>typeof value==='object'&&value!==null?(value.t!==undefined?rich(value.t):value.r!==undefined?list(value.r).map(r=>rich(r.t)).join(''):value['#text']??''):String(value??'');
const col=ref=>{let n=0;for(const char of String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase()||'')n=n*26+char.charCodeAt(0)-64;return n-1;};
const nameHeader=/^(?:药品名称|药品|名称|试剂名称|抗体名称|细胞名称|中文名|英文名)$/;
const locationSection=/^(?:-?\d+\s*[℃°].*|门[上中下]?\d.*|防爆柜|柜[①②③④⑤⑥⑦⑧⑨\d]+|[A-I])$/;
const markedUsed=value=>/^(?:[√✓✔☑]|true|是|1)$/i.test(value)||/(?:已?用完|没了|没有了|耗尽)/.test(value);
const excelDate=(value,date1904)=>{
 const serial=Number(value);if(!Number.isFinite(serial))return value;
 const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,serial<60?31:30);
 const date=new Date(epoch+serial*86400000);return Number.isFinite(date.getTime())?date.toISOString().replace(/T00:00:00\.000Z$/,'').replace(/\.000Z$/,''):value;
};

/** Read worksheet cells themselves: these source exports incorrectly declare A1:A1 dimensions. */
export async function parseReagentWorkbook(buffer,{id,kind,fileName}){
 const zip=await JSZip.loadAsync(buffer),xml=async path=>{
  const file=zip.file(path);if(!file)return null;
  const text=await file.async('string');if(text.length>32*1024*1024)throw Error('清单工作表过大');
  if(/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)throw Error('清单 XML 格式无效');
  return parser.parse(text);
 };
 const workbook=(await xml('xl/workbook.xml'))?.workbook;
 if(!workbook)throw Error('不是有效的 Excel 清单');
 const rels=list((await xml('xl/_rels/workbook.xml.rels'))?.Relationships?.Relationship);
 const targets=new Map(rels.filter(r=>r['@_TargetMode']!=='External').map(r=>[r['@_Id'],posix.normalize(r['@_Target'].startsWith('/')?r['@_Target'].slice(1):posix.join('xl',r['@_Target']))]));
 const strings=list((await xml('xl/sharedStrings.xml'))?.sst?.si).map(rich);
 const styles=(await xml('xl/styles.xml'))?.styleSheet||{};
 const customFormats=new Map(list(styles.numFmts?.numFmt).map(f=>[Number(f['@_numFmtId']),f['@_formatCode']||'']));
 const dateStyles=new Set(list(styles.cellXfs?.xf).flatMap((xf,index)=>{const code=Number(xf['@_numFmtId']),format=(customFormats.get(code)||'').replace(/"[^"]*"|\[[^\]]*\]|\\./g,'');return [14,15,16,17,22,27,28,29,30,31,32,33,34,35,36,50,51,52,53,54,55,56,57,58].includes(code)||/[yd]/i.test(format)?[index]:[];}));
 const date1904=['1','true'].includes(workbook.workbookPr?.['@_date1904']);
 const records=[],sheets=[],warnings=[];
 for(const sheet of list(workbook.sheets?.sheet)){
  const title=sheet['@_name'],path=targets.get(sheet['@_id']);if(!path?.startsWith('xl/'))continue;
  const document=(await xml(path))?.worksheet;if(!document)continue;
  const rows=list(document.sheetData?.row).map((row,index)=>{
   const cells=[];
   for(const c of list(row.c)){
    const column=col(c['@_r']);if(column<0||column>512)continue;
    const type=c['@_t'];let value=type==='s'?strings[Number(c.v)]??'':type==='inlineStr'?rich(c.is):rich(c.v);
    const date=type==='d'||(!type||type==='n')&&dateStyles.has(Number(c['@_s']));
    if(date&&type!=='d'&&value!=='')value=excelDate(value,date1904);
    value=clean(value);if(value)cells.push({column,value,type,date});
   }
   return {row:Number(row['@_r'])||index+1,cells};
  }).filter(row=>row.cells.length);
  let headerAt=rows.slice(0,15).findIndex(row=>row.cells.some(c=>nameHeader.test(c.value))&&row.cells.length>=2);
  // Some source sheets have a mistyped name heading; the adjacent columns establish the layout.
  if(headerAt<0)headerAt=rows.slice(0,15).findIndex(row=>row.cells.some(c=>c.value==='规格')&&row.cells.some(c=>/^CAS$/i.test(c.value)));
  if(headerAt<0){if(rows.length)warnings.push(`${title}：未识别到清单表头`);continue;}
  const headers=rows[headerAt].cells.map(c=>({...c}));
  let nameCol=headers.find(c=>nameHeader.test(c.value))?.column;
  if(nameCol===undefined){nameCol=Math.max(0,headers.find(c=>c.value==='规格').column-1);if(!headers.some(c=>c.column===nameCol))headers.push({column:nameCol,value:'名称'});}
  const find=(cells,pattern)=>headers.filter(h=>pattern.test(h.value)).map(h=>cells.find(c=>c.column===h.column)?.value||'').filter(Boolean).join(' / ');
  let section='',count=0;
  for(const row of rows.slice(headerAt+1)){
   const name=row.cells.find(c=>c.column===nameCol)?.value||'';
   if(nameHeader.test(name))continue;
   if(row.cells.length===1&&name&&locationSection.test(name)){section=name;continue;}
   const cas=find(row.cells,/^CAS(?:号)?$/i),catalogNumber=find(row.cells,/^(?:货号|产品编号|编号)$/);
   const spec=find(row.cells,/^规格$/),brand=find(row.cells,/^(?:品牌|厂家|生产商)$/);
   if(!name&&!cas&&!catalogNumber&&!spec&&!brand)continue;
   const fieldValues=row.cells.map(cell=>({label:headers.find(h=>h.column===cell.column)?.value||`第 ${cell.column+1} 列`,value:cell.value,...(cell.date?{note:'源表以日期存储'}:{})}));
   const casAsDate=fieldValues.some(f=>/^CAS(?:号)?$/i.test(f.label)&&f.note);
   const used=find(row.cells,/用完/),explicitLocation=find(row.cells,/^(?:位置|存放位置|存储位置|储存位置)$/);
   const location=explicitLocation||[title,section].filter(Boolean).join(' · ');
   records.push({id:`${id}:${title}:${row.row}`,sourceId:id,kind,fileName,sheet:title,row:row.row,name:name||'未填写名称',cas,casAsDate,catalogNumber,spec,brand,location,quantity:find(row.cells,/^(?:数量|冻存数量)$/),unit:find(row.cells,/^单位$/),owner:find(row.cells,/^(?:购买人|负责人)$/),date:find(row.cells,/^日期$/),used:markedUsed(used),usedMark:used,fields:fieldValues});count++;
  }
  sheets.push({name:title,count});
 }
 if(!sheets.length)throw Error('未找到包含名称、规格或 CAS 等字段的清单工作表');
 return {records,sheets,warnings};
}
