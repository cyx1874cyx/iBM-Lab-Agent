/** Re-render copies of selected archived specs into a separate test directory. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {runPlotJob} from '../../src/runtime/plot-job.js';
import {plotSpecSchema} from '../../src/plot/workspace.js';

const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,'Missing '+name);return resolve(process.argv[i+1]);};
const output=arg('--output'),python=arg('--python'),source=arg('--data');await mkdir(output,{recursive:true});
const versions=process.argv.filter(arg=>arg.startsWith('--version=')).map(arg=>resolve(arg.slice(10)));assert.ok(versions.length>=1);
const config={command:python,cwd:output,env:{...process.env,ORIGIN_MCP_TOOL_PROFILE:'full'}};
const spawnImpl=(command,args,options)=>spawn(command,args,{...options,windowsHide:true,stdio:['ignore','pipe','pipe']});const runs=[];
for(const [index,version] of versions.entries()){
 const saved=JSON.parse(await readFile(join(version,'绘图配置.json'),'utf8')),target=plotSpecSchema.parse(saved.spec),spec=plotSpecSchema.parse(saved.originSpec||saved.spec);
 const start=Date.now(),renderId=randomUUID(),specHash=createHash('sha256').update(JSON.stringify(spec)).digest('hex');let progress;
 const result=await runPlotJob(config,'render',{path:source,output:join(output,'run-'+(index+1)),spec,referenceSpec:target,specHash,renderId,layoutMode:process.argv.includes('--probe')?'fixed-probe-test':'fixed-test'},{spawnImpl,onProgress:info=>{progress={elapsedMs:Date.now()-start,id:info.renderId};}});
 const readback=result.readback;runs.push({version,original:join(version,'figure.png'),fixed:result.preview.path,progressMs:progress?.elapsedMs,totalMs:Date.now()-start,pixels:result.pixelVerification,collision:readback.collision,passed:readback.passed,geometry:readback.layers?.map(row=>({width:row.properties?.['layer.width'],height:row.properties?.['layer.height']}))});
 await writeFile(join(output,'fixed-versions-report.json'),JSON.stringify({runs},null,2));console.log(JSON.stringify({run:index+1,totalMs:runs.at(-1).totalMs,collision:readback.collision?.status,passed:readback.passed,geometry:runs.at(-1).geometry}));
}
