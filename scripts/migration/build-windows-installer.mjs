/** Fixed-source native Windows installer. Never modifies the upstream checkout. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extractPackageArchive } from '../../electron-next/release-runtime.mjs';

const repo=fileURLToPath(new URL('../..',import.meta.url));
const arg=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0,name+' required');return resolve(process.argv[index+1]);};
const next=arg('--next-root'),python=arg('--python-resource'),archives=arg('--archives'),output=arg('--output');
assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');
assert.equal(execFileSync('git',['-C',next,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'838ba60fd79362087c0a0d134efee671c284786a');
const runtime=join(next,'dsh-desktop-next'),require=createRequire(join(runtime,'package.json'));
const nextManifest=JSON.parse(readFileSync(join(runtime,'package.json')));
assert.equal(nextManifest.version,'2.0.17-next');assert.equal(require('electron/package.json').version,'44.0.0');
mkdirSync(output,{recursive:true});const work=mkdtempSync(join(output,'build-')),appDir=join(work,'app'),resources=join(work,'resources');mkdirSync(appDir);mkdirSync(resources);
const skip=path=>!path.split(/[\\/]/).some(part=>['node_modules','.git','__pycache__','.pytest_cache'].includes(part));
for(const name of ['lib','assets','cordis.patch.yml','host.cordis.patch.yml'])cpSync(join(runtime,name),join(appDir,name),{recursive:true,dereference:true,filter:skip});
cpSync(join(runtime,'scripts/node-bin'),join(appDir,'scripts/node-bin'),{recursive:true});
mkdirSync(join(appDir,'build'));cpSync(join(runtime,'build/app-icon.ico'),join(appDir,'build/app-icon.ico'));
for(const name of ['ibm-bootstrap.mjs','release-runtime.mjs'])cpSync(join(repo,'electron-next',name),join(appDir,name));
const mainFile=join(appDir,'lib/main.js');let main=readFileSync(mainFile,'utf8');
assert.equal(main.split('from "./browser-guests.js"').length,2);
main=main.replace('from "./browser-guests.js"','from "../node_modules/dsh-lab-agent/electron-next/sidebar-desktop.mjs"');
const preloadFile=join(appDir,'lib/preload-app.cjs');
writeFileSync(preloadFile,readFileSync(preloadFile,'utf8')+'\n'+readFileSync(join(repo,'electron-next/sidebar-preload.cjs'),'utf8'));
assert.equal(main.split('app.setName("DSH NEXT")').length,2);main=main.replace('app.setName("DSH NEXT")','app.setName("iBM Lab Agent")');
assert.equal(main.split('const updates = new NextUpdates({').length,2);
main=main.replace(/(const updates = new NextUpdates\(\{[\s\S]*?packaged:) app\.isPackaged/,'$1 false');
assert.ok(main.includes('const updates = new NextUpdates({\n\tversion,\n\tplatform: process.platform,\n\tpackaged: false'));
writeFileSync(mainFile,main);

// Copy actual installed production dependencies, preserving different nested
// versions. Package-local node_modules is composed explicitly, never copied.
const seen=new Map(),rootVersions=new Map(),packages=[];
function locate(name,parent){const resolver=createRequire(join(parent,'package.json'));try{return dirname(resolver.resolve(name+'/package.json'));}catch{const file=resolver.resolve.paths(name)?.map(root=>join(root,name,'package.json')).find(existsSync);if(!file)throw Error('Missing installed dependency '+name);return dirname(file);}}
function collect(name,parent,destinationParent=appDir,ancestors=new Map()){
 const source=realpathSync(locate(name,parent)),data=JSON.parse(readFileSync(join(source,'package.json')));
 if(ancestors.get(name)===data.version)return;
 let target;
 if(!rootVersions.has(name)){rootVersions.set(name,data.version);target=join(appDir,'node_modules',name);}
 else if(rootVersions.get(name)===data.version)target=join(appDir,'node_modules',name);
 else target=join(destinationParent,'node_modules',name);
 if(seen.has(target)){
  assert.deepEqual(JSON.parse(readFileSync(join(seen.get(target),'package.json'))),data,'Conflicting packaged dependency '+name);return;
 }
 seen.set(target,source);cpSync(source,target,{recursive:true,dereference:true,filter:path=>skip(path.slice(source.length+1))});packages.push({name,version:data.version,path:target.slice(appDir.length+1)});
 const chain=new Map(ancestors);chain.set(name,data.version);
 const dependencies={...data.dependencies};
 for(const [peer,version] of Object.entries(data.peerDependencies??{}))if(!data.peerDependenciesMeta?.[peer]?.optional)dependencies[peer]??=version;
 for(const dependency of Object.keys(dependencies))collect(dependency,source,target,chain);
 for(const dependency of Object.keys(data.optionalDependencies??{})){
  let directory;try{directory=locate(dependency,source);}catch{continue;}
  const optional=JSON.parse(readFileSync(join(directory,'package.json')));
  if(optional.os&&!optional.os.includes('win32')&&!optional.os.includes('!darwin'))continue;
  if(optional.cpu&&!optional.cpu.includes('x64'))continue;
  collect(dependency,source,target,chain);
 }
}
for(const name of Object.keys(nextManifest.dependencies))rootVersions.set(name,JSON.parse(readFileSync(join(locate(name,runtime),'package.json'))).version);
for(const name of Object.keys(nextManifest.dependencies))collect(name,runtime);
const ledger=JSON.parse(readFileSync(join(archives,'release-archives.json')));assert.equal(ledger.packages.length,81);
const archivedDir=join(resources,'archives');mkdirSync(archivedDir);
for(const item of ledger.packages){
 const bytes=readFileSync(item.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
 let destination=join(appDir,'node_modules',item.name);
 if(existsSync(join(destination,'package.json'))&&JSON.parse(readFileSync(join(destination,'package.json'))).version!==item.version)destination=join(appDir,'node_modules/dsh-lab-agent/node_modules',item.name);
 if(!existsSync(join(destination,'package.json')))extractPackageArchive(bytes,destination);
 item.file=basename(item.path);delete item.path;writeFileSync(join(archivedDir,item.file),bytes);
}
writeFileSync(join(archivedDir,'release-archives.json'),JSON.stringify(ledger,null,2)+'\n');
cpSync(python,join(resources,'python'),{recursive:true,dereference:true,filter:skip});
for(const name of ['nature-skills','mnova-mcp'])cpSync(join(repo,'vendor',name),join(resources,'vendor',name),{recursive:true,dereference:true,filter:skip});
cpSync(join(repo,'vendor.lock.json'),join(resources,'vendor.lock.json'));
cpSync(join(repo,'python/requirements.lock'),join(resources,'requirements.lock'));
const release={ibm:'0.5.8-rc.1',source:execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),next:'2.0.17-next',nextCommit:'838ba60fd79362087c0a0d134efee671c284786a',kernel:'0.2.0-rc.2',electron:'44.0.0',python:'3.12.11',channel:'migration-preview',signed:false,automaticUpdates:false};
writeFileSync(join(resources,'release.json'),JSON.stringify(release,null,2)+'\n');
// Cordis discovers the Desktop client through this exact package identity.
// Branding belongs to appId/productName/app.setName, not the plugin package name.
const manifest={...nextManifest,version:release.ibm,main:'ibm-bootstrap.mjs',description:'iBM Lab Agent Electron migration preview',author:'iBM Lab',scripts:{}};delete manifest.build;delete manifest.devDependencies;
assert.equal(manifest.name,'dsh-desktop-next');
for(const item of ledger.packages)if(item.name.startsWith('dsh-lab-'))manifest.dependencies[item.name]=item.version;
writeFileSync(join(appDir,'package.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(work,'payload-packages.json'),JSON.stringify(packages,null,2)+'\n');
const config={appId:'cn.ibm.lab-agent.electron',productName:'iBM Lab Agent Electron',asar:false,npmRebuild:false,electronVersion:'44.0.0',electronDist:dirname(require('electron')),directories:{app:appDir,output:join(output,'dist'),buildResources:join(runtime,'build')},files:['**/*'],extraResources:[{from:resources,to:'.',filter:['**/*']}],electronFuses:{runAsNode:true,onlyLoadAppFromAsar:false,enableEmbeddedAsarIntegrityValidation:false},win:{target:[{target:'nsis',arch:['x64']}],icon:join(runtime,'build/app-icon.ico'),signAndEditExecutable:true,artifactName:'iBM-Lab-Agent-${version}-Electron-x64-Setup.${ext}'},nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'iBM Lab Agent Electron',deleteAppDataOnUninstall:false,runAfterFinish:false,include:join(next,'dsh-plugin-desktop-beta/build/installer.nsh')},publish:null};
config.toolsets={nsis:'1.2.1'};
writeFileSync(join(work,'builder.json'),JSON.stringify(config,null,2)+'\n');
writeFileSync(join(output,'build-location.json'),JSON.stringify({work,appDir,resources,release},null,2)+'\n');
console.log('Prepared fixed Electron payload: '+work);
if(process.argv.includes('--prepare-only'))process.exit(0);
const env={...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY:'1'};
for(const key of Object.keys(env))if(/^(WIN_)?CSC_(LINK|KEY_PASSWORD|NAME)$/.test(key))delete env[key];
const child=spawn(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir',appDir,'--win','--x64','--config',join(work,'builder.json')],{cwd:appDir,env,stdio:'inherit',windowsHide:true});
const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});assert.equal(code,0,'Installer build failed');
console.log('Windows installer output: '+join(output,'dist'));
