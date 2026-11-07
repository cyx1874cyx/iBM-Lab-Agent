/** Run the source UI on the verified Electron runtime. No archives or installer. */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adaptWorkbenchLayout } from './workbench-layout-adapter.mjs';
import {adaptDesktopPreviews} from './desktop-preview-adapter.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const sourceResources = resolve(arg('--resources') || join(repo, '../../work/literature-ui-20261020/resources'));
const electron = resolve(arg('--electron') || join(repo, '../../outputs/electron-next-p1/next/dsh-desktop-next/node_modules/electron/dist/electron.exe'));
const directory = resolve(arg('--directory') || join(repo, '../../work/workbench-dev-20261021'));
const resources = join(directory, 'resources');
const home = join(directory, 'home');
const application = join(directory, 'application');
for (const path of [join(sourceResources, 'app/lib/main.js'), electron]) if (!existsSync(path)) throw Error('Development runtime missing: ' + path);
mkdirSync(application, { recursive: true });
if (!existsSync(join(resources, 'app/package.json'))) {
 console.log('Preparing an independent development runtime (one-time copy)');
 cpSync(join(sourceResources, 'app'), join(resources, 'app'), { recursive: true });
 for (const name of ['archives', 'python', 'vendor']) symlinkSync(join(sourceResources, name), join(resources, name), 'junction');
 for (const name of ['release.json', 'requirements.lock', 'vendor.lock.json']) cpSync(join(sourceResources, name), join(resources, name));
}
const layoutClient = join(resources, 'app/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js');
const webDocument=join(resources,'app/lib/web-document.js');
writeFileSync(webDocument,adaptDesktopPreviews(readFileSync(webDocument,'utf8')));
writeFileSync(layoutClient, adaptWorkbenchLayout(readFileSync(layoutClient, 'utf8')));
for (const script of ['build-rag.mjs','build-client.mjs', 'migration/build-domain-packages.mjs']) {
 const result = spawnSync(process.execPath, [join(repo, 'scripts', script)], { cwd: repo, windowsHide: true, stdio: 'inherit' });
 if (result.status !== 0) throw Error('Development build failed: ' + script);
}
writeFileSync(join(application, 'package.json'), JSON.stringify({ name: 'ibm-lab-development', productName: 'iBM Lab', version: '0.1.0', type: 'module', main: 'bootstrap.mjs' }, null, 2));
const bootstrap = `
import {app,BrowserWindow} from 'electron';
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,watch,writeFileSync,renameSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {builtinModules} from 'node:module';
import {initializeRelease} from ${JSON.stringify(pathToFileURL(join(repo, 'electron-next/release-runtime.mjs')).href)};
import {NextProfiles} from ${JSON.stringify(pathToFileURL(join(resources, 'app/lib/profiles.js')).href)};
const repo=${JSON.stringify(repo)},resources=${JSON.stringify(resources)},home=${JSON.stringify(home)};
app.setName('iBM Lab');
initializeRelease({home,resources,electron:process.execPath,profiles:NextProfiles});
const profiles=new NextProfiles(home);
profiles.finishOnboarding('ibm-lab');profiles.dismissAccountSetup('ibm-lab');
const profile=profiles.directory('ibm-lab');
// Backend changes are loaded on development restart; source trees never replace dependencies.
for(const target of [join(profile,'node_modules/dsh-lab-agent'),join(resources,'app/node_modules/dsh-lab-agent')]){
 for(const tree of ['lib','src','skills','electron-next','scripts/runtime'])cpSync(join(repo,tree),join(target,tree),{recursive:true});
 cpSync(join(repo,'vendor/mnova-mcp/src/mnova_mcp'),join(target,'vendor/mnova-mcp/src/mnova_mcp'),{recursive:true});
 cpSync(join(repo,'vendor/mnova-mcp/skill/nmr-analyze-simulate'),join(target,'vendor/mnova-mcp/skill/nmr-analyze-simulate'),{recursive:true});
 // Install the prediction dependency closure into the private plugin directory.
 // Resolve each package from its own source location to preserve nested versions.
 const copied=new Set();
 const copyDependency=(name,from)=>{
  if(builtinModules.includes(name)||name.startsWith('node:'))return;
  let search=from,dir;
  while(true){const candidate=join(search,'node_modules',name);if(existsSync(join(candidate,'package.json'))){dir=candidate;break;}const parent=join(search,'..');if(parent===search)throw Error('Cannot locate dependency '+name);search=parent;}
  const manifest=JSON.parse(readFileSync(join(dir,'package.json'))),key=name+'@'+manifest.version;
  if(copied.has(key))return;copied.add(key);
  const dest=join(target,'node_modules',name);mkdirSync(join(dest,'..'),{recursive:true});cpSync(dir,dest,{recursive:true,dereference:true});
  for(const child of Object.keys(manifest.dependencies||{}))copyDependency(child,dir);
 };
 for(const name of ['openchemlib-extended','indigo-ketcher','xml2js'])copyDependency(name,repo);
}
function copyClientAtomic(source,target){const pending=target+"."+process.pid+".tmp";copyFileSync(source,pending);renameSync(pending,target);}
function syncClient(){
 for(const name of ['dsh-lab-agent','dsh-lab-ui'])copyClientAtomic(join(repo,name==='dsh-lab-ui'?'packages/dsh-lab-ui/client/index.js':'client/index.js'),join(profile,'node_modules',name,'client/index.js'));
 // Electron 实际加载 resources/app 中的副本；不同步会把界面锁在旧版本。
 for(const name of ['dsh-lab-agent','dsh-lab-ui'])copyClientAtomic(join(repo,name==='dsh-lab-ui'?'packages/dsh-lab-ui/client/index.js':'client/index.js'),join(resources,'app/node_modules',name,'client/index.js'));
 for(const name of ['dsh-lab-agent','dsh-lab-ui']){const target=join(profile,'node_modules',name,'package.json');const manifest=JSON.parse(readFileSync(target));const source=JSON.parse(readFileSync(join(repo,'package.json')));manifest.dsh.client=source.dsh.client;if(name==='dsh-lab-agent'){manifest.exports=source.exports;manifest.dsh=source.dsh;}writeFileSync(target,JSON.stringify(manifest,null,2));}
 // 应用目录里的同一份包也要同步 exports/cordis patch，否则新服务行解析不到。
 {const appManifestPath=join(resources,'app','node_modules','dsh-lab-agent','package.json');const appManifest=JSON.parse(readFileSync(appManifestPath));const source=JSON.parse(readFileSync(join(repo,'package.json')));appManifest.exports=source.exports;appManifest.dsh=source.dsh;writeFileSync(appManifestPath,JSON.stringify(appManifest,null,2));}
 copyFileSync(join(repo,'presets/lab-research/preset.patch.yml'),join(profile,'node_modules/dsh-lab-ui/preset.patch.yml'));
 // 开发运行时必须用仓库里的 bundle 装配（新增服务行否则永远不生效）。
 // 插件目录在开发态可能是指向仓库的 junction；src 与 dest 解析到同一实路径时跳过复制。
 {const src=join(repo,'plugins/literature/lib'),dest=join(profile,'node_modules/@ibm-lab/literature/lib');let same=false;try{same=existsSync(dest)&&realpathSync(src)===realpathSync(dest);}catch{}if(!same)cpSync(src,dest,{recursive:true,force:true});}
 copyFileSync(join(repo,'cordis.patch.yml'),join(profile,'node_modules/dsh-lab-agent/cordis.patch.yml'));
 copyFileSync(join(repo,'cordis.patch.yml'),join(resources,'app/node_modules/dsh-lab-agent/cordis.patch.yml'));
 copyFileSync(join(repo,'presets/lab-research/preset.patch.yml'),join(profile,'node_modules/dsh-lab-agent/presets/lab-research/preset.patch.yml'));
 copyFileSync(join(repo,'presets/lab-research/preset.patch.yml'),join(resources,'app/node_modules/dsh-lab-ui/preset.patch.yml'));
 copyFileSync(join(repo,'presets/lab-research/preset.patch.yml'),join(resources,'app/node_modules/dsh-lab-agent/presets/lab-research/preset.patch.yml'));
}
syncClient();
let timer,busy=false,dirty=false,retries=0;
function rebuild(){
 if(busy){dirty=true;return;}busy=true;dirty=false;
 const child=spawn(process.execPath,[join(repo,'scripts/build-client.mjs')],{cwd:repo,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
 child.once('exit',code=>{
  if(code===0){
   const child2=spawn(process.execPath,[join(repo,'scripts/migration/build-domain-packages.mjs')],{cwd:repo,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
   child2.once('exit',result=>{busy=false;if(result===0){retries=0;syncClient();for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed())window.webContents.reload();}if(dirty)rebuild();});
  }else{busy=false;if(dirty)rebuild();else if(retries++<3)timer=setTimeout(rebuild,750);}
 });
}
const watcher=watch(join(repo,'client/src'),{recursive:true},()=>{clearTimeout(timer);retries=0;timer=setTimeout(rebuild,400);});
app.once('before-quit',()=>{watcher.close();clearTimeout(timer);});
await import(${JSON.stringify(pathToFileURL(join(resources, 'app/lib/main.js')).href)});
if(process.argv.includes('--verify-window-resize')){
 const {verifyWorkbenchWindow}=await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts/verify-workbench-window.mjs')).href)});
 void app.whenReady().then(()=>verifyWorkbenchWindow({BrowserWindow,output:${JSON.stringify(directory)}}));
}
`;
writeFileSync(join(application, 'bootstrap.mjs'), bootstrap);
const descriptor = { directory, home, application, resources, electron, source: repo };
writeFileSync(join(directory, 'development.json'), JSON.stringify(descriptor, null, 2));
console.log('iBM Lab development home: ' + home);
if (!process.argv.includes('--prepare-only')) {
 const env = { ...process.env, DSH_DESKTOP_NEXT_HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
 delete env.ELECTRON_RUN_AS_NODE;
 const child = spawn(electron, [application, '--remote-debugging-port=0', ...(process.argv.includes('--verify-window-resize') ? ['--verify-window-resize'] : [])], { cwd: dirname(electron), env, stdio: 'inherit', windowsHide: true });
 child.once('error', error => { console.error(error.message); process.exitCode = 1; });
 child.once('exit', code => { process.exitCode = code ?? 1; });
}
