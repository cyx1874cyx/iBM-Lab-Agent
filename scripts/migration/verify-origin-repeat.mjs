/** Independent Origin pixel repeatability and progress timing check. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {runPlotJob} from '../../src/runtime/plot-job.js';
import {plotSpecSchema} from '../../src/plot/workspace.js';

const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,'Missing '+name);return resolve(process.argv[i+1]);};
const output=arg('--output'),python=arg('--python'),quick=process.argv.includes('--quick'),fixed=process.argv.includes('--fixed'),fast=process.argv.includes('--fast-legacy');await mkdir(output,{recursive:true});
const source=join(output,'synthetic.csv');await writeFile(source,'Time,A,B\n0,2,3\n1,3,5\n2,5,6\n3,6,8\n4,8,9\n');
const spec=plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1,2],xLabel:'Time (s)',yLabel:'Signal',legendStyle:{size:32},xAxis:{scale:'linear',min:0,max:4},yAxis:{scale:'linear',min:0,max:10}});
const spawnImpl=(command,args,options)=>spawn(command,args,{...options,windowsHide:true,stdio:['ignore','pipe','pipe']});
const config={command:python,cwd:output,env:{...process.env,ORIGIN_MCP_TOOL_PROFILE:'full'}},specHash=createHash('sha256').update(JSON.stringify(spec)).digest('hex'),runs=[];
try{
 for(let i=1;i<=3;i++){
  const renderId=randomUUID(),start=Date.now();let progress;
  const result=await runPlotJob(config,'render',{path:source,output:join(output,'run-'+i),spec,specHash,renderId,...(quick?{tier:'preview'}:{}),...(fixed?{layoutMode:'fixed-test'}:fast?{layoutMode:'fast-legacy-test'}:{})},{spawnImpl,onProgress:async info=>{progress={...info,elapsedMs:Date.now()-start};}});
  if(quick){runs.push({totalMs:Date.now()-start,finalPixels:result.pixels,preview:result.preview.path});console.log(JSON.stringify({run:i,totalMs:runs.at(-1).totalMs,tier:result.tier}));continue;}
  const plotted=result.readback?.graph?.layers?.[0]?.plots?.map(plot=>plot.name)||[];
  assert.equal(plotted.length,2);assert.match(plotted[0],/_B$/);assert.match(plotted[1],/_C$/);
  assert.equal(progress?.specHash,specHash);assert.equal(progress?.renderId,renderId);
  runs.push({progressMs:progress.elapsedMs,totalMs:Date.now()-start,probeEqualsFinal:result.pixelVerification.equal,finalPixels:result.pixelVerification.final,plotBindings:plotted,collision:result.readback?.collision?.status,origin:result.origin.path});
  console.log(JSON.stringify({run:i,progressMs:progress.elapsedMs,totalMs:runs.at(-1).totalMs,probeEqualsFinal:result.pixelVerification.equal}));
 }
 const repeatable=runs.every(row=>JSON.stringify(row.finalPixels)===JSON.stringify(runs[0].finalPixels));
 const report={repeatable,runs,latencyTargetMet:quick?runs.every(row=>row.totalMs<=4000):runs.every(row=>row.progressMs<=4000&&row.totalMs<=12000)};await writeFile(join(output,'repeat-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({repeatable,latencyTargetMet:report.latencyTargetMet,report:join(output,'repeat-report.json')}));if(!repeatable)process.exitCode=1;
}catch(error){await writeFile(join(output,'repeat-report.json'),JSON.stringify({error:error.message,runs},null,2));throw error;}
