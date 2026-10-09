/** iBM composition adapter: official NEXT guest leases and official Browser UI. */
import { DesktopBrowserGuests as NextGuests } from '../../../lib/browser-guests.js';
import { app, session, ipcMain } from 'electron';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createScientificRuntime } from './scientific-runtime.mjs';
import { createDesktopPet } from './desktop-pet.mjs';

const CHANNEL='ibm:sidebar-browser-open';
const workspaceKey=value=>process.platform==='win32'?value.replaceAll('\\','/').toLowerCase():value;
export class DesktopBrowserGuests extends NextGuests {
 constructor(hostOrigins) {
  super(hostOrigins);
  this.owners=new Set();this.requests=new Map();this.managed=new Set();this.sockets=new Set();
  const root=join(process.env.DSH_DESKTOP_NEXT_HOME??process.env.DSH_HOME,'lab-agent','scientific-desktop');
  const config={embedded:true,userData:join(root,'session'),downloadsRoot:join(root,'downloads'),getHostOrigins:hostOrigins,allowedLocalOrigins:JSON.parse(process.env.IBM_SIDEBAR_TEST_ORIGINS??'[]'),openGuest:input=>this.openGuest(input)};
  mkdirSync(config.downloadsRoot,{recursive:true});
  this.runtime=createScientificRuntime(config,packet=>{for(const socket of this.sockets)socket.write(JSON.stringify(packet)+'\n');});
  this.pet=createDesktopPet({root,mainWindow:()=>[...this.owners].find(owner=>!owner.isDestroyed())?.getOwnerBrowserWindow()});
  const pipe=process.platform==='win32'?`\\\\.\\pipe\\ibm-sidebar-${randomUUID()}`:join(root,'ipc-'+randomUUID()+'.sock');
  const auth=randomBytes(32).toString('hex');
  process.env.IBM_SCIENTIFIC_MAIN_ENDPOINT=JSON.stringify({pipe,auth});
  this.server=createServer(socket=>{
   let verified=false;const deadline=setTimeout(()=>socket.destroy(),3000);
   const lines=createInterface({input:socket});
   socket.on('error',()=>{});socket.once('close',()=>{clearTimeout(deadline);this.sockets.delete(socket);if(verified&&this.sockets.size===0)void this.pet.update({connected:false,tasks:[]});});
   lines.on('line',line=>{
    let packet;try{packet=JSON.parse(line);}catch{socket.destroy();return;}
    if(!verified){if(packet.auth!==auth){socket.destroy();return;}verified=true;clearTimeout(deadline);this.sockets.add(socket);socket.write(JSON.stringify({event:'ready',electron:process.versions.electron})+'\n');return;}
    const execute=packet.method==='pet-state'?this.pet.update(packet.input):packet.method==='pet-settings'?this.pet.settings(packet.input):this.runtime.dispatch(packet.method,packet.input);
    Promise.resolve(execute).then(result=>socket.write(JSON.stringify({id:packet.id,result})+'\n'),error=>socket.write(JSON.stringify({id:packet.id,error:error.message})+'\n')).catch(()=>{});
   });
  });
  this.server.listen(pipe);this.server.unref();
  ipcMain.on('ibm:sidebar-ready',event=>{if(this.owners.has(event.sender)&&event.sender.getURL().startsWith('dsh-app://app/'))for(const request of this.requests.values())this.notify(request,event.sender);});
  ipcMain.on('ibm:sidebar-rejected',(event,{id,reason}={})=>{const request=this.requests.get(id);if(request?.owner===event.sender){this.requests.delete(id);clearTimeout(request.timer);request.reject(Error(String(reason??'无法打开课题浏览器').slice(0,160)));}});
  ipcMain.on('ibm:sidebar-visible',(event,{id,contentsId}={})=>{const request=this.requests.get(id);if(request?.owner===event.sender&&request.focusContentsId===contentsId&&event.sender.getURL().startsWith('dsh-app://app/')){this.requests.delete(id);clearTimeout(request.timer);request.resolve({shown:true,sidebarVisible:true,contentsId});}});
  app.once('before-quit',()=>{this.server.close();for(const socket of this.sockets)socket.destroy();this.pet.dispose();});
 }
 acquire(owner,workspace) {
  if(!this.partitions.has(workspace)){
   const partition='persist:ibm-sidebar-'+createHash('sha256').update(workspaceKey(workspace)).digest('hex');
   this.partitions.set(workspace,partition);
   const browserSession=session.fromPartition(partition),previous=new Set(browserSession.listeners('will-download'));
   super.configureSession(browserSession);
   for(const listener of browserSession.listeners('will-download'))if(!previous.has(listener))browserSession.removeListener('will-download',listener);
   this.runtime.configure(partition);
  }
  const reservation=super.acquire(owner,workspace);
  this.leases.get(reservation.lease).workspace=workspace;
  return reservation;
 }
 bind(window,attachInput) {
  super.bind(window,attachInput);const owner=window.webContents;this.owners.add(owner);owner.once('destroyed',()=>this.owners.delete(owner));
  // Run after official lease validation, changing only the native PDF capability.
  owner.on('will-attach-webview',(event,preferences,params)=>{const id=String(params.src??'').startsWith('about:blank#')?params.src.slice(12):'';const row=this.leases.get(id);if(!event.defaultPrevented&&row?.owner===owner&&row.partition===params.partition)preferences.plugins=true;});
  owner.on('did-attach-webview',(_event,guest)=>guest.once('dom-ready',()=>{
   const pair=[...this.leases].find(([,row])=>row.guest===guest);if(!pair)return;
   const [id,row]=pair;
   const lease=this.runtime.attachGuest(id,guest,row.workspace,row.partition,()=>this.revealGuest(window,owner,guest,row));
   const request=[...this.requests.values()].find(request=>!request.focusContentsId&&request.owner===owner&&workspaceKey(request.workspace)===workspaceKey(row.workspace));
   if(request){row.projectId=request.projectId;row.sessionIds=request.sessionIds;row.sessionId=request.sessionId;lease.sessionId=request.sessionId;}
   if(request){this.managed.add(id);guest.on('did-start-navigation',(_event,url,_inPlace,mainFrame)=>{
    if(!mainFrame||url!==request.url||request.settled)return;
    request.settled=true;this.requests.delete(request.id);clearTimeout(request.timer);
    // Chromium is still inside navigation notification here. Calling stop()
    // reentrantly can destroy its active navigation and terminate the process.
    // Complete the reservation only after cancellation on the next event turn,
    // so the Host cannot race the initial portal with the publisher navigation.
    setImmediate(()=>{
     if(guest.isDestroyed()){request.reject(Error('课题侧栏浏览器已关闭'));return;}
     if(request.blank)guest.stop();
     request.resolve({lease:id,url:request.blank?'about:blank':url,persistent:true,sidebar:true});
    });
   });}
   guest.once('destroyed',()=>this.managed.delete(lease.id));
  }));
 }
 notify(request,owner) {request.owner=owner;owner.send(CHANNEL,{id:request.id,workspace:request.workspace,url:request.url,projectId:request.projectId,sessionId:request.sessionId,sessionIds:request.sessionIds??[],focusContentsId:request.focusContentsId});}
 revealGuest(window,owner,guest,row){
  window.show();window.focus();
  return new Promise((resolve,reject)=>{
   const request={id:randomUUID(),owner,workspace:row.workspace,projectId:row.projectId,sessionId:row.sessionId,sessionIds:row.sessionIds,focusContentsId:guest.id,resolve,reject};
   request.timer=setTimeout(()=>{this.requests.delete(request.id);reject(Error('文献侧栏未显示，请进入对应课题对话后重试'));},15000);
   this.requests.set(request.id,request);this.notify(request,owner);
  });
 }
 async openGuest(input) {
  input={...input,url:new URL(input.url).href};
  for(const id of this.managed){const row=this.runtime.leases.get(id);if(row&&!row.window.isDestroyed()&&workspaceKey(row.workspace)===workspaceKey(input.workspace)&&(!input.sessionId||row.sessionId===input.sessionId)){await this.runtime.dispatch('focus',{lease:id});if(!input.blank)await this.runtime.dispatch('navigate',{lease:id,url:input.url});return this.runtime.dispatch('state',{lease:id});}}
  const owner=[...this.owners].find(owner=>!owner.isDestroyed()&&owner.getURL().startsWith('dsh-app://app/'));
  if(!owner)throw Error('请先打开应用主界面，再启动文献任务');
  return new Promise((resolve,reject)=>{
   const request={...input,id:randomUUID(),owner,resolve,reject};
   request.timer=setTimeout(()=>{this.requests.delete(request.id);reject(Error('课题侧栏浏览器未就绪，请打开对应课题对话后重试'));},20000);
   this.requests.set(request.id,request);this.notify(request,owner);
  });
 }
}
