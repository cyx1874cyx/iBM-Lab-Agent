/** Offline first-run setup. No live profiles, credentials or research data are read. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync, renameSync, symlinkSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export function extractPackageArchive(bytes, destination) {
 const tar=gunzipSync(bytes);let offset=0,pax={},longName;
 const field=(start,length)=>tar.subarray(offset+start,offset+start+length).toString('utf8').split('\0')[0];
 while(offset+512<=tar.length && tar[offset]!==0){
  const size=parseInt(field(124,12).trim()||'0',8),type=field(156,1)||'0';
  if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw Error('Invalid archive length');
  const content=tar.subarray(offset+512,offset+512+size);
  if(type==='x'){
   pax={};let index=0;
   while(index<content.length){const space=content.indexOf(32,index),length=Number(content.subarray(index,space).toString());if(space<0||!Number.isSafeInteger(length)||length<3||index+length>content.length)throw Error('Invalid archive metadata');const entry=content.subarray(space+1,index+length-1).toString(),equal=entry.indexOf('=');pax[entry.slice(0,equal)]=entry.slice(equal+1);index+=length;}
  }else if(type==='L')longName=content.toString().split('\0')[0];
  else{
   const name=pax.path??longName??[field(345,155),field(0,100)].filter(Boolean).join('/');pax={};longName=undefined;
   if(name==='package'&&type==='5'){offset+=512+Math.ceil(size/512)*512;continue;}
   if(!['0','5'].includes(type)||!name.startsWith('package/')||name.includes('\\'))throw Error('Unsupported archive entry');
   const part=name.slice(8),target=resolve(destination,part),rel=relative(resolve(destination),target);
   if(isAbsolute(rel)||rel.startsWith('..')||part.split('/').some(value=>value==='..'||value.includes(':')))throw Error('Archive path escapes package');
   if(type==='5')mkdirSync(target,{recursive:true});else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);}
  }
  offset+=512+Math.ceil(size/512)*512;
 }
}

function realDirectory(path){
 if(existsSync(path)&&(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()))throw Error('Release setup requires a real directory');
 mkdirSync(path,{recursive:true});
}

/** Kernel packages contain process-local Symbols; every plugin must import the
 * same physical modules as the Agent loop. Keep replaced installer copies as
 * recovery backups, never alter research data or the bundled kernel itself. */
export function shareKernelModules({home,resources,ledger}){
 const modules=join(resolve(home),'profiles','ibm-lab','node_modules');realDirectory(modules);
 const modulesRelative=relative(realpathSync(home),realpathSync(modules));if(isAbsolute(modulesRelative)||modulesRelative.startsWith('..'))throw Error('Kernel module directory escapes home');
 const packagedModules=join(resolve(resources),'app','node_modules');
 const runtimeModules=existsSync(packagedModules)?packagedModules:join(resolve(resources),'..','app','node_modules');
 let backup;const shared=[];
 for(const item of ledger.packages){
  if(!/^@deepseek-ai\/[a-z0-9._-]+$/i.test(item.name))continue;
  const source=join(runtimeModules,item.name),target=join(modules,item.name);
  const shipped=JSON.parse(readFileSync(join(source,'package.json')));
  if(shipped.name!==item.name||shipped.version!==item.version)throw Error('Kernel dependency version mismatch: '+item.name);
  realDirectory(dirname(target));
  const existing=lstatSync(target,{throwIfNoEntry:false});
  if(existing?.isSymbolicLink()&&existsSync(target)&&realpathSync(target)===realpathSync(source)){shared.push(item.name);continue;}
  let saved;
  if(existing){
   if(!existing.isSymbolicLink()){
    const installed=JSON.parse(readFileSync(join(target,'package.json')));
    if(installed.name!==item.name||installed.version!==item.version)throw Error('Unmanaged kernel dependency: '+item.name);
    const rel=relative(resolve(home),realpathSync(target));if(isAbsolute(rel)||rel.startsWith('..'))throw Error('Kernel dependency is outside the owned home');
   }
   if(!backup){const recovery=join(resolve(home),'recovery','ibm-kernel-modules');realDirectory(join(resolve(home),'recovery'));realDirectory(recovery);backup=mkdtempSync(join(recovery,'repair-'));}
   saved=join(backup,item.name);mkdirSync(dirname(saved),{recursive:true});renameSync(target,saved);
  }
  try{symlinkSync(realpathSync(source),target,process.platform==='win32'?'junction':'dir');}
  catch(error){if(saved)renameSync(saved,target);throw error;}
  shared.push(item.name);
 }
 return {shared,backup:backup??null};
}

export function initializeRelease({home,resources,electron,profiles}){
 home=resolve(home);resources=resolve(resources);realDirectory(home);
 const release=JSON.parse(readFileSync(join(resources,'release.json')));
 const python=join(resources,'python','python.exe');if(!existsSync(python))throw Error('Bundled Python is missing');
 process.env.DSH_DESKTOP_NEXT_HOME=home;process.env.DSH_HOME=home;
 process.env.IBM_LAB_AGENT_BUNDLED_PYTHON=python;process.env.IBM_LAB_AGENT_BUNDLED_ELECTRON=electron;
 const manager=new profiles(home),marker=join(home,'ibm-release.json');
 const ledger=JSON.parse(readFileSync(join(resources,'archives','release-archives.json')));
 if(existsSync(marker)){const current=JSON.parse(readFileSync(marker));if(current.ibm!==release.ibm)throw Error('Different release data requires an explicit migration');const kernel=shareKernelModules({home,resources,ledger});return {home,initialized:false,python,kernel};}
 const profile=manager.ensure('ibm-lab'),modules=join(profile,'node_modules');realDirectory(modules);
 for(const item of ledger.packages){
  if(!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(item.name))throw Error('Invalid package name');
  const file=join(resources,'archives',item.file),bytes=readFileSync(file);
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256||bytes.length!==item.bytes)throw Error('Release archive integrity mismatch');
  if(item.name.startsWith('@deepseek-ai/'))continue;
  const target=join(modules,item.name);realDirectory(target);extractPackageArchive(bytes,target);
 }
 const file=join(profile,'package.json'),manifest=JSON.parse(readFileSync(file));
 for(const item of ledger.packages)manifest.dependencies[item.name]='file:'+join(resources,'archives',item.file).replaceAll('\\','/');
 for(const name of ['core','runtime','documents','literature','design','analysis','ui'])if(!manifest.dsh.profile.bundles.includes('dsh-lab-'+name))manifest.dsh.profile.bundles.push('dsh-lab-'+name);
 writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
 const workspace=join(profile,'pnpm-workspace.yaml');
 writeFileSync(workspace,readFileSync(workspace,'utf8')+'\noverrides:\n'+ledger.packages.map(item=>'  '+JSON.stringify(item.name)+': '+JSON.stringify(manifest.dependencies[item.name])).join('\n')+'\n');
 const lab=join(home,'lab-agent');realDirectory(lab);
 for(const name of ['vendor.lock.json','requirements.lock'])cpSync(join(resources,name),join(lab,name));
 for(const name of ['nature-skills','mnova-mcp'])cpSync(join(resources,'vendor',name),join(lab,'vendor',name),{recursive:true});
 manager.select('ibm-lab');
 const kernel=shareKernelModules({home,resources,ledger});
 writeFileSync(marker,JSON.stringify({...release,initializedAt:new Date().toISOString()},null,2)+'\n');
 return {home,initialized:true,python,kernel};
}
