import test from 'node:test';
import assert from 'node:assert/strict';
import {installSidebarBrowser} from '../../client/src/sidebar-browser.js';
import {currentDesktopSessionId} from '../../client/src/desktop-client.js';

test('NEXT selected conversation comes from mainView retention, independent of sidebar adoption and history ordering',()=>{
 assert.equal(currentDesktopSessionId({list:{getSnapshot:()=>({byId:{old:{id:'old',retainedBy:{sidebar:1}},fresh:{id:'fresh',retainedBy:{mainView:1}}}})}}),'fresh');
 assert.equal(currentDesktopSessionId({list:{getSnapshot:()=>({current:'legacy'})}}),'legacy');
 assert.equal(currentDesktopSessionId(undefined),undefined);
});

test('existing guest restores its session and expands the collapsed sidebar before visibility acknowledgement',async()=>{
 let handler,expanded=false,selected,focused,ack;
 const tab={dataset:{sidebarRightTab:'browser-tab'}};
 const view={getWebContentsId:()=>42,closest:()=>tab,checkVisibility:()=>expanded,getBoundingClientRect:()=>({width:575,height:724})};
 globalThis.document={querySelectorAll:selector=>selector==='webview'?[view]:[]};
 globalThis.ibmResearchSidebar={onOpen:fn=>{handler=fn;return()=>{};},visible:(...args)=>ack=args,rejected:()=>assert.fail('unexpected rejection')};
 const dispose=installSidebarBrowser({workspaces:{list:{getSnapshot:()=>({phase:'ready',items:[{path:'H:/project',sessionIds:['session-1']}]})}},uiWorkspace:{openSession:id=>selected=id},sidebarRight:{mounted:{getSnapshot:()=>selected},focus:id=>focused=id,isExpanded:()=>expanded,toggleExpanded:()=>expanded=true,openTab:()=>assert.fail('must preserve existing guest and navigation')}});
 try{await handler({id:'reveal-1',workspace:'cwd:H:/project',projectId:'test',sessionIds:['session-1'],focusContentsId:42});assert.equal(selected,'session-1');assert.equal(focused,'browser-tab');assert.equal(expanded,true);assert.deepEqual(ack,['reveal-1',42]);}
 finally{dispose();delete globalThis.document;delete globalThis.ibmResearchSidebar;}
});

test('new project conversation stays selected even when the historical project binding only lists an older conversation',async()=>{
 let handler,opened=0;
 globalThis.document={querySelectorAll:()=>[]};
 globalThis.ibmResearchSidebar={onOpen:fn=>{handler=fn;return()=>{};},rejected:(_id,reason)=>assert.fail(reason)};
 const dispose=installSidebarBrowser({
  workspaces:{list:{getSnapshot:()=>({phase:'ready',items:[{path:'H:/project',sessionIds:['old-session','new-session']}]})}},
  sessions:{list:{getSnapshot:()=>({byId:{old:{id:'old-session',retainedBy:{sidebar:1}},fresh:{id:'new-session',retainedBy:{mainView:1}}}})}},
  uiWorkspace:{openSession:()=>assert.fail('must not switch away from the current new conversation')},
  sidebarRight:{mounted:{getSnapshot:()=> 'new-session'},openTab:()=>opened++}
 });
 try{await handler({id:'open-new',workspace:'cwd:H:/project',sessionIds:['old-session'],url:'https://publisher.example/paper'});assert.equal(opened,1);}
 finally{dispose();delete globalThis.document;delete globalThis.ibmResearchSidebar;}
});

test('an explicit initiating conversation wins over both the current selection and historical bindings',async()=>{
 let handler,selected='other-session',opened=0;
 globalThis.document={querySelectorAll:()=>[]};
 globalThis.ibmResearchSidebar={onOpen:fn=>{handler=fn;return()=>{};},rejected:(_id,reason)=>assert.fail(reason)};
 const dispose=installSidebarBrowser({
  workspaces:{list:{getSnapshot:()=>({phase:'ready',items:[{path:'H:/project',sessionIds:['old-session','new-session','other-session']}]})}},
  sessions:{list:{getSnapshot:()=>({current:selected})}},uiWorkspace:{openSession:id=>selected=id},
  sidebarRight:{mounted:{getSnapshot:()=>selected},openTab:()=>opened++}
 });
 try{await handler({id:'source-new',workspace:'cwd:H:/project',sessionId:'new-session',sessionIds:['old-session']});assert.equal(selected,'new-session');assert.equal(opened,1);}
 finally{dispose();delete globalThis.document;delete globalThis.ibmResearchSidebar;}
});

test('a deleted or foreign initiating conversation is rejected instead of silently opening another conversation',async()=>{
 let handler,rejected;
 globalThis.document={querySelectorAll:()=>[]};
 globalThis.ibmResearchSidebar={onOpen:fn=>{handler=fn;return()=>{};},rejected:(_id,reason)=>rejected=reason};
 const dispose=installSidebarBrowser({
  workspaces:{list:{getSnapshot:()=>({phase:'ready',items:[{path:'H:/project',sessionIds:['old-session']}]})}},
  sessions:{list:{getSnapshot:()=>({current:'old-session'})}},uiWorkspace:{openSession:()=>assert.fail('must not switch')},
  sidebarRight:{mounted:{getSnapshot:()=> 'old-session'},openTab:()=>assert.fail('must not open another conversation')}
 });
 try{await handler({id:'missing-source',workspace:'cwd:H:/project',sessionId:'removed-session',sessionIds:['old-session']});assert.match(rejected,/发起文献任务的对话/);}
 finally{dispose();delete globalThis.document;delete globalThis.ibmResearchSidebar;}
});
