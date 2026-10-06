import test from 'node:test';
import assert from 'node:assert/strict';
import {installSidebarBrowser} from '../../client/src/sidebar-browser.js';

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
