import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extractPackageArchive, shareKernelModules, refreshProductModules, initializeRelease, compatibleReleaseUpgrade } from '../../electron-next/release-runtime.mjs';
import { load } from 'js-yaml';

function archive(name,content,type='0'){
 const bytes=Buffer.from(content),header=Buffer.alloc(512);header.write(name);header.write(bytes.length.toString(8).padStart(11,'0'),124);header.write(type,156);
 return gzipSync(Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512),Buffer.alloc(1024)]));
}
test('release archive extraction keeps exact package bytes in a Chinese path',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-release-'));
 try{const target=join(dir,'中文目录');extractPackageArchive(archive('package/lib/note.txt','fixture bytes'),target);assert.equal(readFileSync(join(target,'lib/note.txt'),'utf8'),'fixture bytes');}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('old offline kernel copies become one module identity with recoverable backups and intact memory',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-kernel-')),home=join(dir,'home'),resources=join(dir,'resources');
 const item={name:'@deepseek-ai/dsh-tools',version:'0.2.0-rc.2'},ledger={packages:[item]};
 const shipped=join(resources,'app/node_modules',item.name),installed=join(home,'profiles/ibm-lab/node_modules',item.name);
 const identity=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const [a,b]=await Promise.all([import(${JSON.stringify(pathToFileURL(join(shipped,'index.js')).href)}),import(${JSON.stringify(pathToFileURL(join(installed,'index.js')).href)})]);console.log(JSON.stringify(a.scheduler===b.scheduler));`],{encoding:'utf8',windowsHide:true}));
 try{
  for(const path of [shipped,installed]){mkdirSync(path,{recursive:true});writeFileSync(join(path,'package.json'),JSON.stringify({...item,type:'module'}));writeFileSync(join(path,'index.js'),'export const scheduler=Symbol("tools.scheduler");');}
  const memory=join(home,'项目记忆.md');writeFileSync(memory,'v1: preserved');assert.equal(identity(),false);
  const result=shareKernelModules({home,resources,ledger});assert.equal(identity(),true);assert.equal(realpathSync(installed),realpathSync(shipped));
  assert.equal(readFileSync(join(result.backup,item.name,'index.js'),'utf8'),'export const scheduler=Symbol("tools.scheduler");');
  assert.equal(readFileSync(memory,'utf8'),'v1: preserved');assert.equal(shareKernelModules({home,resources,ledger}).backup,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('kernel sharing refuses incompatible versions before replacing an installed package',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-kernel-')),home=join(dir,'home'),resources=join(dir,'resources'),name='@deepseek-ai/dsh-tools';
 try{
  const shipped=join(resources,'app/node_modules',name),installed=join(home,'profiles/ibm-lab/node_modules',name);
  for(const path of [shipped,installed])mkdirSync(path,{recursive:true});
  writeFileSync(join(shipped,'package.json'),JSON.stringify({name,version:'other'}));writeFileSync(join(installed,'package.json'),JSON.stringify({name,version:'0.2.0-rc.2'}));
  assert.throws(()=>shareKernelModules({home,resources,ledger:{packages:[{name,version:'0.2.0-rc.2'}]}}),/version mismatch/);
  assert.equal(JSON.parse(readFileSync(join(installed,'package.json'))).version,'0.2.0-rc.2');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('release extraction rejects traversal, external archive entries and links',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-release-'));
 try{for(const [name,type] of [['package/../escape','0'],['package/C:/escape','0'],['elsewhere/escape','0'],['package/link','2']])assert.throws(()=>extractPackageArchive(archive(name,'bad',type),join(dir,'package')));assert.equal(existsSync(join(dir,'escape')),false);}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('same-version product refresh backs up stale packages and preserves project/configuration data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-products-')),home=join(dir,'home'),resources=join(dir,'resources');
 try{
  mkdirSync(join(resources,'archives'),{recursive:true});mkdirSync(home,{recursive:true});
  const packages=['dsh-lab-agent',...['core','runtime','documents','literature','design','analysis','ui'].map(name=>'dsh-lab-'+name)].map(name=>{
   const version='0.5.8-rc.1',file=name+'.tgz',bytes=archive('package/package.json',JSON.stringify({name,version,build:'new'}));writeFileSync(join(resources,'archives',file),bytes);
   const installed=join(home,'profiles/ibm-lab/node_modules',name);mkdirSync(installed,{recursive:true});writeFileSync(join(installed,'package.json'),JSON.stringify({name,version,build:'old'}));writeFileSync(join(installed,'stale.txt'),'recover me');
   return {name,version,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  for(const file of ['项目记忆.md','ibm-release.json','.credentials.yaml'])writeFileSync(join(home,file),'fixture preserved');
  const result=refreshProductModules({home,resources,ledger:{packages}});assert.equal(result.updated.length,8);
  for(const item of packages){const installed=join(home,'profiles/ibm-lab/node_modules',item.name);assert.equal(JSON.parse(readFileSync(join(installed,'package.json'))).build,'new');assert.equal(existsSync(join(installed,'stale.txt')),false);assert.equal(readFileSync(join(result.backup,'previous',item.name,'stale.txt'),'utf8'),'recover me');}
  for(const file of ['项目记忆.md','ibm-release.json','.credentials.yaml'])assert.equal(readFileSync(join(home,file),'utf8'),'fixture preserved');
  assert.deepEqual(refreshProductModules({home,resources,ledger:{packages}}),{updated:[],backup:null});
  const invalid={packages:packages.map((item,i)=>i===0?{...item,sha256:'corrupt'}:item)};
  assert.throws(()=>refreshProductModules({home,resources,ledger:invalid}),/integrity/);assert.equal(JSON.parse(readFileSync(join(home,'profiles/ibm-lab/node_modules/dsh-lab-agent/package.json'))).build,'new');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('cross-version upgrades require a declared source and the same NEXT/kernel',()=>{
 const current={ibm:'0.5.8-rc.1',kernel:'0.2.0-rc.2',nextCommit:'pinned-next'};
 const release={...current,ibm:'0.6.0-rc.1',upgradeFrom:['0.5.8-rc.1']};
 assert.equal(compatibleReleaseUpgrade(current,release),true);
 assert.equal(compatibleReleaseUpgrade(current,{...release,upgradeFrom:[]}),false);
 assert.equal(compatibleReleaseUpgrade(current,{...release,kernel:'another-kernel'}),false);
 assert.equal(compatibleReleaseUpgrade(current,{...release,nextCommit:'another-next'}),false);
 assert.equal(compatibleReleaseUpgrade(release,current),false);
});

test('0.5.8 Electron data upgrades to 0.6.0 with package backups and preserved user data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-release-upgrade-')),home=join(dir,'home'),resources=join(dir,'resources');
 const names=['dsh-lab-agent',...['core','runtime','documents','literature','design','analysis','ui'].map(name=>'dsh-lab-'+name)];
 const profile=join(home,'profiles/ibm-lab');
 try{
  mkdirSync(join(profile,'node_modules'),{recursive:true});mkdirSync(join(resources,'archives'),{recursive:true});mkdirSync(join(resources,'python'),{recursive:true});
  writeFileSync(join(resources,'python/python.exe'),'fixture');
  const packages=names.map(name=>{
   const installed=join(profile,'node_modules',name);mkdirSync(installed,{recursive:true});writeFileSync(join(installed,'package.json'),JSON.stringify({name,version:'0.5.8-rc.1'}));
   const bytes=archive('package/package.json',JSON.stringify({name,version:'0.6.0-rc.1'})),file=name+'-0.6.0-rc.1.tgz';writeFileSync(join(resources,'archives',file),bytes);
   return {name,version:'0.6.0-rc.1',file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  const current={ibm:'0.5.8-rc.1',kernel:'0.2.0-rc.2',nextCommit:'pinned-next',initializedAt:'2026-10-02T00:00:00.000Z'};
  writeFileSync(join(home,'ibm-release.json'),JSON.stringify(current));
  writeFileSync(join(home,'ibm-plugin-payload.json'),JSON.stringify({packages:Object.fromEntries(names.map(name=>[name,'old']))}));
  writeFileSync(join(resources,'release.json'),JSON.stringify({...current,ibm:'0.6.0-rc.1',upgradeFrom:['0.5.8-rc.1']}));
  writeFileSync(join(resources,'archives/release-archives.json'),JSON.stringify({packages}));
  writeFileSync(join(profile,'package.json'),JSON.stringify({dependencies:{'my-plugin':'1.2.3'},dsh:{profile:{bundles:['my-plugin','dsh-lab-ui']}}}));
  writeFileSync(join(profile,'pnpm-workspace.yaml'),'packages: []\noverrides:\n  my-plugin: 1.2.3\n');
  const sentinels=new Map([[join(profile,'cordis.patch.yml'),'custom profile configuration'],[join(home,'project.json'),'retained project and conversation'],[join(home,'desktop-pet.json'),'saved quote and position']]);
  for(const [path,value] of sentinels)writeFileSync(path,value);
  class Profiles { ensure(){throw Error('Existing profile must be preserved');} }
  const result=initializeRelease({home,resources,electron:process.execPath,profiles:Profiles});
  assert.deepEqual(result.plugins.updated,names);assert.equal(result.initialized,false);
  for(const name of names){assert.equal(JSON.parse(readFileSync(join(profile,'node_modules',name,'package.json'))).version,'0.6.0-rc.1');assert.equal(JSON.parse(readFileSync(join(result.plugins.backup,'previous',name,'package.json'))).version,'0.5.8-rc.1');}
  const manifest=JSON.parse(readFileSync(join(profile,'package.json'))),workspace=load(readFileSync(join(profile,'pnpm-workspace.yaml'),'utf8'));
  assert.equal(manifest.dependencies['my-plugin'],'1.2.3');assert.deepEqual(manifest.dsh.profile.bundles,['my-plugin','dsh-lab-ui']);assert.equal(workspace.overrides['my-plugin'],'1.2.3');
  for(const item of packages){assert.ok(manifest.dependencies[item.name].endsWith(item.file));assert.equal(workspace.overrides[item.name],manifest.dependencies[item.name]);}
  for(const [path,value] of sentinels)assert.equal(readFileSync(path,'utf8'),value);
  const marker=JSON.parse(readFileSync(join(home,'ibm-release.json')));assert.equal(marker.ibm,'0.6.0-rc.1');assert.equal(marker.upgradedFrom,'0.5.8-rc.1');assert.equal(marker.initializedAt,current.initializedAt);
  assert.deepEqual(initializeRelease({home,resources,electron:process.execPath,profiles:Profiles}).plugins.updated,[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
