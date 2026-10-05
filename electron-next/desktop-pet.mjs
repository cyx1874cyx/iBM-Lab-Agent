import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_ICON } from '../client/src/brand-icon.js';

export function createDesktopPet({root,mainWindow}) {
 const file=join(root,'desktop-pet.json');let preference={visible:true},window,last={tasks:[],connected:false};
 try{const value=JSON.parse(readFileSync(file,'utf8'));preference={visible:value.visible!==false,...(Number.isFinite(value.x)&&Number.isFinite(value.y)?{x:value.x,y:value.y}:{})};}catch{}
 const persist=()=>{mkdirSync(root,{recursive:true});writeFileSync(file,JSON.stringify(preference));};
 const publish=async()=>{if(window&&!window.isDestroyed()&&!window.webContents.isLoading())await window.webContents.executeJavaScript(`window.renderPet(${JSON.stringify({icon:BRAND_ICON,...last})})`).catch(()=>{});};
 const ready=app.whenReady().then(async()=>{
  const area=screen.getPrimaryDisplay().workArea;
  const saved=Number.isFinite(preference.x)?screen.getDisplayNearestPoint({x:preference.x,y:preference.y}).workArea:area;
  const x=Math.max(saved.x,Math.min(preference.x??area.x+area.width-318,saved.x+saved.width-300));
  const y=Math.max(saved.y,Math.min(preference.y??area.y+area.height-250,saved.y+saved.height-220));
  window=new BrowserWindow({x,y,width:300,height:220,show:false,frame:false,transparent:true,resizable:false,skipTaskbar:true,alwaysOnTop:true,title:'iBM 科研桌面宠物',webPreferences:{partition:'ibm-desktop-pet',preload:fileURLToPath(new URL('./pet-preload.cjs',import.meta.url)),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.on('moved',()=>{const [px,py]=window.getPosition();preference.x=px;preference.y=py;persist();});
  window.on('close',event=>{if(!app.isQuitting){event.preventDefault();preference.visible=false;window.hide();persist();}});
  await window.loadFile(fileURLToPath(new URL('./desktop-pet.html',import.meta.url)));await publish();
  if(preference.visible)window.showInactive();
 });
 ipcMain.on('ibm:pet-action',(event,action)=>{if(event.sender!==window?.webContents)return;if(action==='hide'){preference.visible=false;window.hide();persist();}if(action==='main'){const main=mainWindow();main?.show();main?.focus();}});
 return {
  async update(input){await ready;last={connected:input?.connected===true,tasks:(input?.tasks??[]).slice(0,8).map(row=>({id:String(row.id??'').slice(0,100),label:String(row.label??'').slice(0,48),stage:String(row.stage??'').slice(0,100),status:row.status,startedAt:Number(row.startedAt)||0,updatedAt:Number(row.updatedAt)||0,percent:Number.isFinite(row.percent)?Math.max(0,Math.min(100,row.percent)):null,detail:String(row.detail??'').slice(0,80)}))};await publish();return {updated:true};},
  async settings(input={}){await ready;if(typeof input.visible==='boolean'){preference.visible=input.visible;preference.visible?window.showInactive():window.hide();persist();}return {available:true,visible:preference.visible};},
  dispose(){if(window&&!window.isDestroyed())window.destroy();}
 };
}
