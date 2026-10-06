/** Actual Electron download flow with isolated local publisher fixtures. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { bootLite as sourceBootLite } from '../../tests/helpers/boot-lite.mjs';
import { apply as sourceRegisterTools } from '../../lib/tasks-tool.js';
const arg=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0,name+' required');return resolve(process.argv[index+1]);};
const electron=arg('--electron'),python=arg('--python'),output=arg('--output');await mkdir(output,{recursive:true});
let bootLite=sourceBootLite,registerTools=sourceRegisterTools;
const app=process.argv.includes('--app')?arg('--app'):null;
if(app){
 const plugin=join(app,'node_modules/dsh-lab-agent'),require=createRequire(join(app,'package.json'));
 let helper=await readFile(new URL('../../tests/helpers/boot-lite.mjs',import.meta.url),'utf8');
 helper=helper.replace('from "@deepseek-ai/dsh-app-boot"','from '+JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href));
 helper=helper.replace(/export const repoRoot = [^;]+;/,'export const repoRoot = '+JSON.stringify(plugin)+';');
 helper=helper.replaceAll('join(repoRoot, "node_modules"', 'join('+JSON.stringify(app)+', "node_modules"');
 const file=join(output,'packaged-boot-fixture.mjs');await writeFile(file,helper);bootLite=(await import(pathToFileURL(file))).bootLite;
 registerTools=(await import(pathToFileURL(join(plugin,'lib/tasks-tool.js')))).apply;
}
process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=python;
process.env.DSH_DESKTOP_NEXT_HOME=join(output,'desktop-app-home');process.env.DSH_HOME=process.env.DSH_DESKTOP_NEXT_HOME;
const pdf=Buffer.from('%PDF-1.4\n/Type /Page\nDownload fixture\n'+' '.repeat(12000)+'\n%%EOF');
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/paper.pdf'){res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="fixture.pdf"'});res.end(pdf);}
 else if(url.pathname==='/paper'){res.end('<title>publisher-fixture</title><button onclick="window.open(\'/paper.pdf\',\'download\')">Download PDF</button>');}
 else if(url.pathname==='/denied'){res.writeHead(403,{'content-type':'text/html'});res.end('<title>Access denied</title>');}
 else if(url.pathname==='/paywall'){res.end('<title>Article</title><p>Purchase this article</p><button>Download PDF</button>');}
 else if(url.pathname==='/login'){res.end('<title>Institution</title><input type="password">');}
 else if(url.pathname==='/verification'){res.end('<title>Security check</title><p>Verify you are human</p>');}
 else if(url.pathname==='/slow'){res.end('<title>publisher-fixture</title><img src="/pending-resource"><button>Download PDF</button>');}
 else if(url.pathname==='/pending-resource'){setTimeout(()=>res.end(''),45000).unref();}
 else {res.end('<title>institution-fixture</title>');}
});server.listen(0,'127.0.0.1');await once(server,'listening');const fixture='http://127.0.0.1:'+server.address().port;
let handle;const report={ok:false,packaged:Boolean(app),checks:[],scope:'Real isolated Electron fixture pages and tool execution; no live institution credentials or model account used.'};
const wait=async(predicate,label)=>{for(let i=0;i<200;i++){if(await predicate())return;await delay(100);}throw Error('Timed out: '+label);};
try{
 handle=await bootLite({storageRoot:join(output,'storage'),coreOnly:true,includePython:false,coreConfig:{projectsRoot:join(output,'projects')},extraRows:[
  {id:'runtime',name:'dsh-lab-agent/runtime'}, {id:'documents',name:'dsh-lab-agent/documents'}, {id:'goals',name:'dsh-lab-agent/goal-profiles'}, {id:'templates',name:'dsh-lab-agent/ppt-templates'}, {id:'notes',name:'dsh-lab-agent/note-templates'}, {id:'workflow',name:'dsh-lab-agent/workflows'}, {id:'tasks',name:'dsh-lab-agent/tasks'}, {id:'capture',name:'dsh-lab-agent/manual-capture'},
  {id:'desktop',name:'dsh-lab-agent/scientific-desktop',config:{electron,root:join(output,'desktop'),headless:true,allowedLocalOrigins:[fixture]}}
 ]});
 const ctx=handle.ctx,desktop=ctx.ibmScientificDesktop,capture=ctx.labCapture;
 await ctx.ibmCore.createProject({id:'download-test',name:'下载隔离验收'});
 const originalNavigate=desktop.navigate.bind(desktop);
 // Map only the synthetic DOI destination to our approved local publisher fixture.
 desktop.navigate=(lease,url)=>{const id=url.split('fixture-')[1];return originalNavigate(lease,url.startsWith('https://doi.org/10.1038/fixture-')?fixture+(id==='direct'?'/paper.pdf':['denied','paywall','login','verification','slow'].includes(id)?'/'+id:'/paper'):url);};
 for(const id of ['manual','agent','queued','direct'])await ctx.ibmCore.commitSourceBundle({id,projectId:'download-test',title:'Fixture '+id,doi:'10.1038/fixture-'+id,status:'succeeded',createdAt:'2026-10-05',updatedAt:'2026-10-05'});
 const manual=await desktop.browserAction({action:'capture',projectId:'download-test',bundleId:'manual',kind:'pdf'});
 const window=await desktop.windowForProject('download-test');assert.equal(window.title,'publisher-fixture');
 assert.equal(capture.getTask(manual.task.id).status,'armed');report.checks.push('manual-capture-navigates-to-own-publisher-after-arming');
 await capture.cancelTask(manual.task.id);assert.equal(desktop.status().armed,0);
 for(const id of ['denied','paywall','login','verification','slow']){
  await ctx.ibmCore.commitSourceBundle({id,projectId:'download-test',title:'Access fixture '+id,doi:'10.1038/fixture-'+id,status:'succeeded',createdAt:'2026-10-06',updatedAt:'2026-10-06'});
  const started=Date.now(),created=await desktop.browserAction({action:'capture',projectId:'download-test',bundleId:id,kind:'pdf'});
  const expected={denied:'access-denied',paywall:'access-denied',login:'login-required',verification:'verification-required',slow:'unknown'}[id];
  await wait(()=>capture.getTask(created.task.id)?.access?.state===expected,'access evidence '+id);
  const saved=capture.getTask(created.task.id),view=capture.describeTask(saved);
  if(['denied','paywall'].includes(id)){assert.equal(saved.status,'failed');assert.equal(view.phase,'access-denied');assert.equal(desktop.status().armed,0);assert.equal(capture.listTaskViews('download-test').filter(x=>!['completed','cancelled','failed'].includes(x.task.status)).length,0);}
  else{assert.equal(saved.status,'armed');if(id==='slow')assert.ok(Date.now()-started<10000,'DOM-ready must not wait for the pending image');else assert.equal(view.requiresUserAction,true);await capture.cancelTask(saved.id);}
  assert.equal(ctx.ibmCore.getArtifact('source-bundle',id).pdfPath,undefined);
  report.checks.push('page-access-'+id);
 }
 const tools=[];registerTools({tools:{register:tool=>tools.push(tool)},labCapture:capture,labTasks:ctx.labTasks,get:name=>ctx.get(name)});
 const tool=name=>{const row=tools.find(tool=>tool.name===name);assert.ok(row,name);return row;};
 const agent=await tool('lab_publisher_browser_download').execute({projectId:'download-test',bundleId:'agent',kind:'pdf'},{});assert.equal(agent.ok,true,agent.error);assert.equal(agent.taskCreated,true);assert.ok(!JSON.stringify(agent).includes('token'));
 await wait(()=>desktop.captureStatus()?.pendingTaskId===agent.taskId,'native agent claim');
 await wait(async()=>(await desktop.state(window.lease)).title==='publisher-fixture','agent publisher navigation');
 assert.equal(capture.getDesktopWebVpnStatus().stale,false);report.checks.push('agent-tool-opens-publisher-without-legacy-iframe-or-login-heartbeat');
 const queued=await capture.createAgentCaptureTask({projectId:'download-test',bundleId:'queued',kind:'si'});await delay(150);assert.equal(desktop.status().armed,1);assert.ok(desktop.captureQueue.includes(queued.id));await capture.cancelTask(queued.id);assert.ok(!desktop.captureQueue.includes(queued.id));report.checks.push('same-project-downloads-queue-and-cancel-without-overwriting-active-task');
 const observed=await tool('lab_browser_observe').execute({projectId:'download-test',taskId:agent.taskId,scope:'download'},{});assert.equal(observed.ok,true,observed.error);
 await wait(()=>capture.getBrowserOperation(observed.operationId,'download-test').status==='completed','native observation');
 const observation=capture.getBrowserOperation(observed.operationId,'download-test').result;assert.ok(observation.candidates.length);const candidate=observation.candidates.find(row=>row.text==='Download PDF');assert.ok(candidate);
 const clicked=await tool('lab_browser_click').execute({projectId:'download-test',taskId:agent.taskId,observationId:observation.observationId,elementId:candidate.elementId},{});assert.equal(clicked.ok,true,clicked.error);
 await wait(()=>capture.getTask(agent.taskId).status==='completed','popup PDF capture');
 const bundle=ctx.ibmCore.getArtifact('source-bundle','agent');assert.deepEqual(await readFile(bundle.pdfPath),pdf);assert.ok(bundle.pdfSha256);report.checks.push('native-observe-click-popup-download-file-validation-and-project-archive');
 const direct=await desktop.browserAction({action:'capture',projectId:'download-test',bundleId:'direct',kind:'pdf'});
 await wait(()=>capture.getTask(direct.task.id).status==='completed','direct attachment capture');assert.deepEqual(await readFile(ctx.ibmCore.getArtifact('source-bundle','direct').pdfPath),pdf);report.checks.push('direct-PDF-navigation-abort-is-a-download-not-a-failure');
 await assert.rejects(desktop.broker.call('click',{lease:window.lease,observationId:observation.observationId,elementId:candidate.elementId}),/失效|导航/);report.checks.push('old-observation-cannot-click-after-navigation');
 if(app){assert.equal(existsSync(join(output,'desktop-app-home/ibm-release.json')),false);report.checks.push('packaged-sidecar-entry-does-not-initialize-or-open-main-profile');}
 report.ok=true;
}catch(error){report.error=String(error);throw error;}
finally{await handle?.dispose();await new Promise(done=>server.close(done));await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
