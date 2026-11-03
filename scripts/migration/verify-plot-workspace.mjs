/** Real, owned-data Origin rendering acceptance; preserves the user's project. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {runPlotJob} from '../../src/runtime/plot-job.js';
import {plotSpecSchema} from '../../src/plot/workspace.js';
const arg=name=>{const at=process.argv.indexOf(name);assert.ok(at>=0,'Missing '+name);return resolve(process.argv[at+1]);};
const python=arg('--python'),output=arg('--output');await mkdir(output,{recursive:true});
const path=join(output,'synthetic.csv');await writeFile(path,'Time (s),Sample A,Sample B\n0,2,3\n1,3,5\n2,5,6\n3,6,8\n4,8,9\n');
const config={command:python,cwd:output,env:{ORIGIN_MCP_TOOL_PROFILE:'full'}};
const spawnImpl=(command,args,options)=>spawn(command,args,{...options,env:{...process.env,...options.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
const events=[];
try{
 const profile=await runPlotJob(config,'inspect',{path,output:join(output,'parsed')},{spawnImpl});
 assert.equal(profile.rows,5);assert.equal(profile.columns.length,3);assert.equal(profile.sheet,'数据');
 events.push({step:'inspect',profile});
 let first;
 for(const [index,kind] of ['line_symbol','scatter','column','bar','box','histogram'].entries()){
  const spec=plotSpecSchema.parse({kind,xCol:0,yCols:kind==='histogram'?[1]:[1,2],xLabel:kind==='box'?'Sample':kind==='histogram'?'Signal':'Time (s)',yLabel:kind==='histogram'?'Frequency':'Signal',lineWidth:index===0?3:4,showLegend:kind!=='histogram'});
  const result=await runPlotJob(config,'render',{path:profile.normalizedPath,output:join(output,'render-'+kind+'-'+Date.now()),spec},{spawnImpl});
  for(const slot of ['preview','pdf','origin'])assert.ok((await readFile(result[slot].path)).length>100);
  first||=result;events.push({step:kind,result});
  await writeFile(join(output,'verification.json'),JSON.stringify({ok:false,events},null,2));
  console.log('passed '+kind);
 }
 await writeFile(join(output,'verification.json'),JSON.stringify({ok:true,events},null,2));console.log(JSON.stringify({ok:true,preview:first.preview.path,evidence:join(output,'verification.json')}));
}catch(error){await writeFile(join(output,'verification.json'),JSON.stringify({ok:false,error:error.message,events},null,2));throw error;}
