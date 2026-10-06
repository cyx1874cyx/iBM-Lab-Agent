// App document only. Research guests receive no preload or IPC bridge.
if(location.protocol==='dsh-app:'&&location.hostname==='app'){
 const {contextBridge,ipcRenderer}=require('electron');
 contextBridge.exposeInMainWorld('ibmResearchSidebar',{
  onOpen(listener){
   const handler=(_event,request)=>listener(request);
   ipcRenderer.on('ibm:sidebar-browser-open',handler);
   ipcRenderer.send('ibm:sidebar-ready');
   return ()=>ipcRenderer.removeListener('ibm:sidebar-browser-open',handler);
  },
  rejected(id,reason){ipcRenderer.send('ibm:sidebar-rejected',{id,reason});},
  visible(id,contentsId){ipcRenderer.send('ibm:sidebar-visible',{id,contentsId});}
 });
}
