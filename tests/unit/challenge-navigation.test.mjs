import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {classifyLiteratureAccess} from '../../electron-next/literature-access.mjs';

async function fixture() {
 const source=(await readFile(new URL('../../electron-next/scientific-runtime.mjs',import.meta.url),'utf8'))
  .replace(/^import .*;\r?\n/gm,'').replace('export function createScientificRuntime','function createScientificRuntime');
 let headers;
 const browserSession=Object.assign(new EventEmitter(),{
  setPermissionRequestHandler(){},setPermissionCheckHandler(){},
  webRequest:{onBeforeRequest(){},onHeadersReceived(fn){headers=fn;}}
 });
 const create=runInNewContext(source+'\ncreateScientificRuntime',{
  URL,setTimeout,clearTimeout,setImmediate,queueMicrotask,randomUUID,classifyLiteratureAccess,
  session:{fromPartition:()=>browserSession},nativePdfResource:()=>false
 });
 const runtime=create({},()=>{}),contents=Object.assign(new EventEmitter(),{
  id:1,url:'https://publisher.example/article?paper=1',loads:[],signals:{text:'Verify you are human'},
  isDestroyed:()=>false,getURL(){return this.url;},getTitle:()=>'',setWindowOpenHandler(){},focus(){},
  async executeJavaScriptInIsolatedWorld(){return this.signals;},
  async loadURL(url){this.loads.push(url);this.url=url;this.emit('did-start-navigation',{},url,false,true);await this.wait;}
 });
 const row=runtime.attachGuest('lease',contents,'workspace','persist:test',()=>{});
 runtime.configure('persist:test');
 return {runtime,contents,row,headers:details=>headers(details,()=>{})};
}

test('reopening a challenged URL preserves the live verification document including its query',async()=>{
 const {runtime,contents,row}=await fixture();
 row.access=classifyLiteratureAccess(contents.signals);
 const state=await runtime.dispatch('navigate',{lease:'lease',url:contents.url});
 assert.equal(state.access.state,'verification-required');assert.equal(contents.loads.length,0);
 // A distinct paper must still be navigable, even on the same pathname.
 await runtime.dispatch('navigate',{lease:'lease',url:'https://publisher.example/article?paper=2'});
 assert.equal(contents.loads.length,1);
});

test('concurrent opens share one navigation and a redirected challenge survives retrying the entry URL',async()=>{
 const {runtime,contents,row}=await fixture();let resolve;
 contents.wait=new Promise(done=>{resolve=done;});
 const url='https://doi.org/10.1000/example';
 const first=runtime.dispatch('navigate',{lease:'lease',url});
 const second=runtime.dispatch('navigate',{lease:'lease',url});
 assert.equal(contents.loads.length,1);
 contents.url='https://publisher.example/article?challenge=fixture';resolve();
 await Promise.all([first,second]);assert.equal(row.access.state,'verification-required');
 await runtime.dispatch('navigate',{lease:'lease',url});assert.equal(contents.loads.length,1);
 // Once the human reaches the article, ordinary navigation remains available.
 row.access=classifyLiteratureAccess({fullText:true});contents.signals={fullText:true};
 await runtime.dispatch('navigate',{lease:'lease',url});assert.equal(contents.loads.length,2);
});

test('Cloudflare challenge response is waiting for verification even before localized page text arrives',async()=>{
 const {runtime,contents,row,headers}=await fixture();contents.signals={};
 headers({resourceType:'mainFrame',webContentsId:1,statusCode:403,responseHeaders:{'Content-Type':['text/html'],'Cf-Mitigated':['challenge']}});
 await runtime.dispatch('navigate',{lease:'lease',url:'https://publisher.example/new'});
 // Feed the response after did-start-navigation cleared the previous document.
 headers({resourceType:'mainFrame',webContentsId:1,statusCode:403,responseHeaders:{'Cf-Mitigated':['challenge']}});
 contents.emit('dom-ready');await new Promise(done=>setImmediate(done));
 assert.equal(row.access.state,'verification-required');
 await runtime.dispatch('navigate',{lease:'lease',url:contents.url});assert.equal(contents.loads.length,1);
 assert.equal(classifyLiteratureAccess({statusCode:403}).state,'access-denied');
 // Popup responses cannot overwrite the primary verification response.
 const popup={isDestroyed:()=>false,webContents:{id:2}};row.popups.add(popup);
 headers({resourceType:'mainFrame',webContentsId:2,statusCode:200,responseHeaders:{'Content-Type':['application/pdf']}});
 assert.equal(row.cfMitigated,'challenge');assert.equal(row.statusCode,403);
});
