import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {runPlotJob} from '../../src/runtime/plot-job.js';
import {plotSpecSchema} from '../../src/plot/workspace.js';
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0);return resolve(process.argv[i+1]);};
const python=arg('--python'),output=arg('--output');await mkdir(output,{recursive:true});
const source=join(output,'source.csv');await writeFile(source,'Time (s),Control,Treated\n0,1,2\n1,2,3\n2,3,5\n3,4,6\n4,5,8\n');
const spawnImpl=(cmd,args,options)=>spawn(cmd,args,{...options,env:{...process.env,...options.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
const config={command:python,cwd:output,env:{ORIGIN_MCP_TOOL_PROFILE:'full'}};
const base={kind:'line_symbol',xCol:0,yCols:[1,2],xLabel:'Time (s)',yLabel:'Signal',titleText:'Editable Origin figure',titleStyle:{bold:true,size:30,color:'#173A50'},xAxis:{scale:'linear',min:0,max:4,step:1,ticks:'out',tickOffsetX:20,tickOffsetY:40,grid:'major',decimals:0,minorTicks:2},yAxis:{scale:'linear',min:0,max:10,step:2,ticks:'both',tickOffsetX:-30,tickOffsetY:10,grid:'none'},series:[{column:1,color:'#B42035',lineWidth:4,lineStyle:1,symbolKind:2,symbolSize:8,label:'Control group'},{column:2,color:'#125FB8',lineWidth:2,lineStyle:0,symbolKind:3,symbolSize:6,label:'Treated group'}],legendOrder:[2,1],legendX:.27,legendY:.17,legendStyle:{size:24},annotations:[{id:'note1',kind:'text',text:'Native text',x:.5,y:.5,style:{size:22,bold:true,color:'#B42035',rotation:15},lineWidth:2,opacity:1},{id:'arrow1',kind:'arrow',text:'',x:.6,y:.7,x2:.8,y2:.6,style:{color:'#008060'},lineWidth:3,opacity:1},{id:'rect1',kind:'rectangle',text:'',x:.6,y:.8,x2:.8,y2:.95,style:{color:'#A08020'},lineWidth:2,opacity:1}]};
const report={ok:false,events:[]};
try{
 for(const [name,fields] of [['objects',base],['panels',{...base,annotations:[],layout:{mode:'panels',columns:2,gap:8,labels:true,panels:[]}}]]){
  const spec=plotSpecSchema.parse(fields),result=await runPlotJob(config,'render',{path:source,output:join(output,name+'-'+Date.now()),spec},{spawnImpl});
  assert.ok(result.svg&&result.scene.objects.some(row=>row.key.startsWith('series:')));for(const layer of result.readback.layers){const p=layer.properties;assert.equal(p['layer.x.ticks'],10);assert.equal(p['layer.y.ticks'],15);assert.equal(p['layer.x.label.offseth'],20);assert.equal(p['layer.x.label.offsetv'],-40);assert.equal(p['layer.y.label.offseth'],-30);assert.equal(p['layer.y.label.offsetv'],-10);}assert.ok((await readFile(result.origin.path)).length>100);
  report.events.push({name,spec,result});await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));console.log('passed '+name);
 }
 report.ok=true;
}catch(error){report.error=error.message;throw error;}
finally{await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,evidence:join(output,'verification.json'),error:report.error}));}
