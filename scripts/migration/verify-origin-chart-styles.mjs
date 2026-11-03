import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {plotSpecSchema} from '../../src/plot/workspace.js';
import {createPlotSession} from '../../src/runtime/plot-session.js';
import {runPlotJob} from '../../src/runtime/plot-job.js';
const root=process.env.PLOT_TEST_DATA||'H:/107-iBM-Agent/iBM-Agent/work/绘图测试数据-20261031';
const output=process.env.PLOT_TEST_OUTPUT||root+'/style-check-'+Date.now();await mkdir(output,{recursive:true});
const config={command:'H:/107-iBM-Agent/iBM-Agent/work/workbench-dev-20261021/resources/python/python.exe',cwd:process.cwd(),env:{...process.env,ORIGIN_MCP_TOOL_PROFILE:'full'}};
const session=createPlotSession(config,(c,a,o)=>spawn(c,a,{...o,windowsHide:true}));
const cases=[['line','01_Time_series.csv',0,[1,2]],['line_symbol','01_Time_series.csv',0,[1,2]],['scatter','02_XY_scatter.csv',0,[1,2]],['column','03_Category_replicates.csv',0,[1,2,3]],['bar','03_Category_replicates.csv',0,[1,2,3]],['box','04_Group_distributions.csv',undefined,[0,1,2,3]],['histogram','05_Size_distribution.csv',undefined,[0]]];
const report=[];
const savedCases=[];
try{for(const [kind,file,xCol,yCols] of cases.filter(c=>!process.argv[2]||process.argv.slice(2).includes(c[0]))){
 try{
 const path=root+'/'+file,spec=plotSpecSchema.parse({kind,xCol,yCols,fontSize:16,titleSize:18,showLegend:false});
 const prepared=await runPlotJob(config,'prepare',{path,output:output+'/'+kind+'/data'},{spawnImpl:(c,a,o)=>spawn(c,a,{...o,windowsHide:true})});
 const dataOrigin=prepared.path;
 await session.run({path,dataOrigin,output:output+'/'+kind+'/initial',spec,tier:'preview'});
 const filled=['column','bar','box','histogram'].includes(kind),symbol=['scatter','line_symbol'].includes(kind);
 const colors=['#C23D51','#2374AB','#168C60','#B36110'];
 const a=plotSpecSchema.parse({...spec,series:yCols.map((column,i)=>({column,color:colors[i],...(filled||symbol?{fillColor:colors[i],borderColor:'#314159'}:{}),lineWidth:2.5,opacity:.7,symbolFill:'solid',...(kind==='histogram'?{binWidth:20}:{}),...(kind==='box'?{boxWidth:32}:{}),...(['bar','column'].includes(kind)?{barGap:40}:{})}))});
 const first=await session.run({path,dataOrigin,output:output+'/'+kind+'/edit-a',spec:a,tier:'preview'});
 const svg=await readFile(first.svg.path,'utf8');
 // Assert actual exported ink, not just successful setter calls or spec values.
 for(const color of colors.slice(0,yCols.length))assert.ok(svg.toLowerCase().includes(color.toLowerCase()),kind+' missing rendered color '+color);
 if(filled||symbol)assert.ok(svg.toLowerCase().includes('#314159'),kind+' missing border color');
 assert.match(svg,/(?:fill|stroke)-opacity[=:\s"]+0\.69/,kind+' rendered opacity missing');
 const b=plotSpecSchema.parse({...a,series:a.series.map((s,i)=>({...s,color:i?'#168C60':'#B36110',fillColor:i?'#168C60':'#B36110',borderColor:'#652C90',opacity:1,lineWidth:4}))});
 const second=await session.run({path,output:output+'/'+kind+'/edit-b',spec:b,tier:'preview'});
 assert.notEqual(first.pixels.pixels,second.pixels.pixels,kind+' edit did not change image');
 assert.ok((await readFile(second.svg.path,'utf8')).toLowerCase().includes('#b36110'),kind+' second color missing');
 const controls=symbol?[['symbolSize',12],['symbolEdgeWidth',50],['symbolFill','open']]:kind==='box'?[['boxWidth',12]]:kind==='histogram'?[['binWidth',40]]:['column','bar'].includes(kind)?[['barGap',10],['lineWidth',1],['lineStyle',1]]:[['lineWidth',1],['lineStyle',1]];
 for(const [field,value] of controls){
  const changed=plotSpecSchema.parse({...b,series:b.series.map(s=>({...s,[field]:value}))});
  const edited=await session.run({path,dataOrigin,output:output+'/'+kind+'/'+field,spec:changed,tier:'preview'});
  assert.notEqual(edited.pixels.pixels,second.pixels.pixels,kind+' '+field+' did not change actual ink');
  if(field==='binWidth'){
   const count=source=>(source.match(/<rect\b[^>]*fill="#B36110"/gi)||[]).length;
   assert.notEqual(count(await readFile(edited.svg.path,'utf8')),count(await readFile(second.svg.path,'utf8')),'bin width must change the number of actual histogram bars');
  }
 }
 await session.run({path,dataOrigin,output:output+'/'+kind+'/reset-controls',spec:b,tier:'preview'});
 // A structural rebuild initially exports at 1800 px; compare two retained
 // previews at the same 900 px rather than mistaking size for a style change.
 const baseline=await session.run({path,dataOrigin,output:output+'/'+kind+'/before-hide',spec:b,tier:'preview'});
 const hidden=await session.run({path,dataOrigin,output:output+'/'+kind+'/hidden',spec:{...b,series:b.series.map(s=>({...s,visible:false}))},tier:'preview'});
 assert.notEqual(hidden.pixels.pixels,baseline.pixels.pixels,kind+' visibility did not change image');
 const restored=await session.run({path,output:output+'/'+kind+'/restored',spec:b,tier:'preview'});
 assert.equal(restored.pixels.pixels,baseline.pixels.pixels,kind+' restoring visibility changed styles');
 if(process.argv.includes('--save')){const saved=await session.run({path,dataOrigin,output:output+'/'+kind+'/saved',spec:b,tier:'full'});const rows=(await readFile(path,'utf8')).trim().split(/\r?\n/).length-1;savedCases.push({name:kind+'-retained',path,spec:b,expectedRows:rows,artifacts:saved});}
 report.push({kind,ok:true,preview:second.preview.path});
 }catch(error){report.push({kind,ok:false,error:error.message});}
 console.log(JSON.stringify(report.at(-1)));
}}finally{await session.close();await writeFile(output+'/report.json',JSON.stringify(report,null,2));if(savedCases.length)await writeFile(output+'/saved-request.json',JSON.stringify({output:output+'/reopen',cases:savedCases},null,2));console.log(output);}
assert.ok(report.length&&report.every(row=>row.ok),'Native chart style verification failed');
