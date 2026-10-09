import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {renderDeckJob} from '../../src/deck-render-job.js';
import {apply} from '../../lib/runtime-tool.js';

test('renderer refuses external input, invalid page ranges and absent session workspace before executing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'deck-scope-'));await mkdir(join(root,'workspace'));await writeFile(join(root,'outside.pptx'),'fixture');
 let calls=0;const deps={spawnImpl:()=>{calls++;throw Error('unexpected execution');}};
 try{
  await assert.rejects(renderDeckJob({workspace:join(root,'workspace'),input:'../outside.pptx'},deps),/当前会话/);
  await assert.rejects(renderDeckJob({workspace:join(root,'workspace'),input:'../outside.pptx',pages:'1-99999999'},deps),/页码/);
  await assert.rejects(renderDeckJob({input:'x.pptx'},deps),/工作区/);
  assert.equal(calls,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('host job invokes only the fixed official helper and verifies its output files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'deck-job-'));await writeFile(join(root,'report.pptx'),'fixture');let observed;
 const spawnImpl=(command,args,options)=>{observed={command,args,options};return spawn(process.execPath,['-e',`const fs=require('fs'),path=require('path');const out=process.argv[1];const png=path.join(out,'page.png'),sheet=path.join(out,'contact-sheet.png');for(const file of [png,sheet])fs.writeFileSync(file,Buffer.from([137,80,78,71,13,10,26,10]));console.log(JSON.stringify({ok:true,pages:[{page:1,path:png,width:1,height:1}],contactSheet:sheet,outDir:out}));`,args[args.indexOf('--out')+1]],{stdio:['ignore','pipe','pipe']});};
 try{
  const result=await renderDeckJob({workspace:root,input:'report.pptx'},{spawnImpl,env:{}});
  assert.equal(result.execution,'host-render-tool');assert.match(observed.args[0],/render-deck\.mjs$/);
  assert.equal(observed.options.cwd,root);assert.match(observed.options.env.TEMP,/\.lab-tmp/);assert.equal(observed.options.env.TEMP,observed.options.env.TMPDIR);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('tool derives workspace from the actual session and never accepts a caller workspace override',async()=>{
 const tools=new Map();let received;
 const ctx={tools:{register:tool=>tools.set(tool.name,tool)},get:()=>({renderDeck:async args=>{received=args;return {ok:true,pages:[],contactSheet:'fixture'};}})};
 apply(ctx);const tool=tools.get('lab_render_deck');assert.ok(tool);
 await tool.execute({input:'a.pptx',workspace:'C:/untrusted'},{agent:{session:{header:{cwd:'H:/actual-session'}}}});
 assert.equal(received.workspace,'H:/actual-session');
});
test('workspace junctions cannot redirect renderer output outside the workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'deck-junction-'));
 const workspace=join(root,'workspace'),external=join(root,'external');await mkdir(workspace);await mkdir(external);await writeFile(join(workspace,'deck.pptx'),'fixture');
 try{await symlink(external,join(workspace,'.lab-tmp'),process.platform==='win32'?'junction':'dir');await assert.rejects(renderDeckJob({workspace,input:'deck.pptx'},{spawnImpl:()=>{throw Error('should not execute');}}),/临时目录/);}
 finally{await rm(root,{recursive:true,force:true});}
});
test('cancellation stops the render worker and does not report a completed review',async()=>{
 const root=await mkdtemp(join(tmpdir(),'deck-cancel-'));await writeFile(join(root,'deck.pptx'),'fixture');const controller=new AbortController();let exited;
 try{await assert.rejects(renderDeckJob({workspace:root,input:'deck.pptx'},{env:{},signal:controller.signal,spawnImpl:()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']});exited=new Promise(resolve=>child.once('close',resolve));setTimeout(()=>controller.abort(Error('fixture cancelled')),50);return child;}}),/cancelled/);await exited;}
 finally{await rm(root,{recursive:true,force:true});}
});
