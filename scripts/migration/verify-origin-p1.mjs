import {mkdir,writeFile} from 'node:fs/promises';import {existsSync} from 'node:fs';import {spawn} from 'node:child_process';import {resolve,join} from 'node:path';
import {plotSpecSchema,materializeNumericAxes} from '../../src/plot/workspace.js';
const root=resolve('tests/fixtures/plot-p1'),output=resolve(process.env.PLOT_P1_OUTPUT||'../../work/plot-p1-'+Date.now());await mkdir(output,{recursive:true});
const cases=[];
for(const kind of ['line','line_symbol','scatter','column','bar','box','histogram']){
 const packed=['bar','box'].includes(kind),source=packed?'nonadjacent.csv':'series.csv',yCols=packed?[4,2]:kind==='histogram'?[1]:[1,2];
 cases.push({name:kind,path:resolve(root,source),expectedRows:packed?4:12,expectedFirst:packed?(kind==='box'?[81,11]:['A',81,11]):undefined,
 spec:plotSpecSchema.parse({kind,xCol:['box','histogram'].includes(kind)?undefined:0,yCols,fontSize:16,titleSize:18,xLabel:'X axis',yLabel:'Y axis',showLegend:true,legendX:.65,legendY:.1,legendStyle:{size:10},xAxis:['line','line_symbol','scatter'].includes(kind)?{min:0,max:12}:{},yAxis:['line','line_symbol','scatter','histogram'].includes(kind)?{min:0,max:20}:{},series:yCols.map((column,i)=>({column,label:i?'Second series':'First series',color:i?'#168C60':'#C23D51',fillColor:i?'#168C60':'#C23D51',borderColor:'#314159',lineWidth:2,lineStyle:1,symbolKind:2,symbolSize:8,symbolEdgeWidth:20,boxWidth:30,...(kind==='histogram'?{binWidth:2}:{})}))})});
}
for(const file of ['negative','positive','crossing','constant'])for(const kind of ['column','bar']){
 const bounds={negative:[-8,-2],positive:[2,8],crossing:[-5,8],constant:[-5,-5]}[file],profile={columns:[{index:0,type:'category',count:3},{index:1,type:'number',count:3,min:bounds[0],max:bounds[1]}]};
 cases.push({name:file+'-'+kind,path:resolve(root,file+'.csv'),expectedRows:3,zeroAxis:kind==='bar'?'x':'y',spec:materializeNumericAxes({kind,xCol:0,yCols:[1],fontSize:16,titleSize:18,showLegend:false},profile)});
}
const selected=process.argv.slice(2),request=resolve(output,'request.json');
if(process.env.PLOT_P1_REUSE)for(const c of cases){const old=process.env.PLOT_P1_REUSE.split(';').map(root=>join(root,c.name,'figure')).find(path=>existsSync(join(path,'figure.opju')));if(old)c.artifacts=Object.fromEntries([['preview','png'],['origin','opju'],['svg','svg']].map(([key,ext])=>[key,{path:join(old,'figure.'+ext)}]));}
await writeFile(request,JSON.stringify({output,cases:cases.filter(c=>!selected.length||selected.includes(c.name))},null,2));
console.log(output);
const child=spawn('H:/107-iBM-Agent/iBM-Agent/work/workbench-dev-20261021/resources/python/python.exe',['-I',resolve('scripts/migration/verify-origin-p1.py'),request],{windowsHide:true,env:{...process.env,ORIGIN_MCP_TOOL_PROFILE:'full'},stdio:'inherit'});process.exitCode=await new Promise(r=>child.once('exit',r));
