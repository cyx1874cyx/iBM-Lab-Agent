import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { extractPackageArchive, shareKernelModules } from '../../electron-next/release-runtime.mjs';

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
