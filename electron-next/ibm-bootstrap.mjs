import { app, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextProfiles } from './lib/profiles.js';
import { initializeRelease } from './release-runtime.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const resources=app.isPackaged?process.resourcesPath:join(root,'..','resources');
try{
 if(process.argv.includes('--ibm-scientific-desktop')){
  if(!process.env.IBM_SCIENTIFIC_DESKTOP_CONFIG)throw Error('Scientific desktop configuration is missing');
  // Packaged Electron ignores a positional JS entry. Use a fixed, shipped
  // entry selected by our private process launch, before profile initialization.
  await import('./node_modules/dsh-lab-agent/electron-next/scientific-main.mjs');
 }else{
 initializeRelease({home:process.env.DSH_DESKTOP_NEXT_HOME??join(process.env.LOCALAPPDATA??app.getPath('appData'),'iBM-Lab-Agent-Electron','dsh'),resources,electron:process.execPath,profiles:NextProfiles});
 await import('./lib/main.js');
 }
}catch(error){
 console.error('iBM release initialization failed:',error.message);
 dialog.showErrorBox('iBM Lab Agent 启动失败',error.message);app.exit(1);
}
