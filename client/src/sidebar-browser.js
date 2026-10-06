import { nativeBrowser, setDesktopProject } from './desktop-client.js';
const key=value=>String(value).replaceAll('\\','/').toLowerCase();
/** Use NEXT's browser page/controller; no custom research WebView is mounted. */
export function installSidebarBrowser(ctx) {
 const bridge=globalThis.ibmResearchSidebar;if(!bridge)return ()=>{};
 const seen=new Set();let disposed=false;
 const stop=bridge.onOpen(async request=>{
  if(!request.id||seen.has(request.id)||disposed)return;seen.add(request.id);
  try{
   for(let i=0;i<40&&ctx.workspaces.list.getSnapshot().phase!=='ready'&&!disposed;i++)await new Promise(done=>setTimeout(done,250));
   const items=ctx.workspaces.list.getSnapshot().items??[];
   const workspace=items.find(item=>key('cwd:'+item.path)===key(request.workspace));
   if(!workspace)throw Error('请先进入此课题的工作区对话，再打开文献浏览器');
   const sessionIds=workspace.sessionIds??[];
   const sessionId=[...(request.sessionIds??[])].reverse().find(id=>sessionIds.includes(id))??sessionIds.at(-1);
   if(!sessionId)throw Error('请先为此课题打开一个对话，再启动文献任务');
   if(request.projectId)setDesktopProject(request.projectId);ctx.uiWorkspace.openSession(sessionId);
   // Opening a restored/off-screen Session precedes adoption of its sidebar
   // store. openTabIn silently ignores that gap; openTab validates readiness.
   let opened=false;
   for(let attempt=0;attempt<80&&!disposed;attempt++){
    if(ctx.sidebarRight.mounted.getSnapshot()===sessionId)try{
     if(request.focusContentsId){
      const view=[...document.querySelectorAll('webview')].find(view=>{try{return view.getWebContentsId()===request.focusContentsId;}catch{return false;}});
      const tab=view?.closest('[data-sidebar-right-tab]');
      if(tab){ctx.sidebarRight.focus(tab.dataset.sidebarRightTab);if(!ctx.sidebarRight.isExpanded())ctx.sidebarRight.toggleExpanded();
       const bounds=view.getBoundingClientRect();
       if(view.checkVisibility()&&bounds.width>100&&bounds.height>100){bridge.visible(request.id,request.focusContentsId);opened=true;break;}
      }
     }else{ctx.sidebarRight.openTab('browser',{params:{url:request.url},revealIfOpened:false});opened=true;break;}
    }catch{}
    await new Promise(done=>setTimeout(done,50));
   }
   if(!opened)throw Error('课题侧栏尚未就绪，请进入对应课题对话后重试');
  }catch(error){bridge.rejected(request.id,error.message);}
 });
 let timer;
 const poll=async()=>{
  if(disposed)return;
  try{
   const state=await nativeBrowser('status');
   if(state?.window?.contentsId)for(const view of document.querySelectorAll('webview')){
    let id;try{id=view.getWebContentsId();}catch{continue;}if(id!==state.window.contentsId)continue;
    const tab=view.closest('[data-sidebar-right-tab]'),input=tab?.querySelector('input'),toolbar=input?.closest('div')?.parentElement;
    if(!toolbar)continue;
    let button=toolbar.querySelector('[data-ibm-capture-download]');
    if(!button){button=document.createElement('button');button.dataset.ibmCaptureDownload='true';button.style.cssText='border:0;background:#e4f2e9;color:#23613b;border-radius:5px;padding:4px 6px;font-size:11px;white-space:nowrap;cursor:pointer';toolbar.append(button);button.onclick=()=>void nativeBrowser('viewer-download').catch(error=>{button.title=error.message;});}
    const capture=state.capture;button.hidden=!capture;
    button.textContent=capture?.state==='uploading'?'正在归档…':capture?.state==='downloading'?'正在下载…':'归档 PDF';
    button.disabled=!capture||capture.state!=='waiting-download'||!/^application\/pdf(?:;|$)/i.test(state.window.documentType??'');button.title='将当前 PDF 下载并归档到课题';
   }
  }catch{}
  if(!disposed)timer=setTimeout(poll,1500);
 };
 void poll();
 return ()=>{disposed=true;clearTimeout(timer);stop();document.querySelectorAll('[data-ibm-capture-download]').forEach(button=>button.remove());};
}
