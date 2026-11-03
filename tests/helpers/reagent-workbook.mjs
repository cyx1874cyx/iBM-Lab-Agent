import JSZip from 'jszip';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const column=index=>{let text='';for(let n=index+1;n;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;};
export async function reagentWorkbook(sheets){
 const zip=new JSZip();
 zip.file('xl/workbook.xml',`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet,i)=>`<sheet name="${escape(sheet.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels',`<Relationships>${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`);
 zip.file('xl/styles.xml','<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>');
 sheets.forEach((sheet,index)=>zip.file(`xl/worksheets/sheet${index+1}.xml`,`<worksheet><dimension ref="A1"/><sheetData>${sheet.rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>value===undefined||value===null?'':typeof value==='object'?`<c r="${column(c)}${r+1}" s="1"><v>${escape(value.dateSerial)}</v></c>`:`<c r="${column(c)}${r+1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`));
 return zip.generateAsync({type:'nodebuffer'});
}

export const reagentFixtureSheets=[{name:'小冰箱',rows:[
 ['用完✔','药品名称','规格','CAS','品牌','数量','位置','货号','备注'],
 [null,'4℃上1'],
 [null,'氘代氯仿','0.6 ml','865-49-6','安耐吉',0,null,'A-001','保持原文'],
 ['√','氘代氯仿','10 ml','865-49-6','另一品牌',1],
 [null,null,'500 g','9004-32-4','品牌'],
 [null,'木瓜蛋白酶'],
 [null,'源表日期 CAS',null,{dateSerial:45000}],
 ]},{name:'危化品白柜',rows:[['duijiai','规格','CAS','品牌','数量'],['磷酸','500 ml','7664-38-2','安耐吉',1]]},{name:'空表',rows:[]}];
