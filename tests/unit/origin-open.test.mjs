import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openOriginProject,validateOriginProject} from '../../electron-next/origin-open.mjs';

test('Origin opens the original archived OPJU, accepts native headers and rejects renamed executables',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-origin-open-'));try{
  const bytes=Buffer.concat([Buffer.from('CPYUA 4.3748 212\n'),Buffer.alloc(200)]),path=join(root,'原始工程.opju');await writeFile(path,bytes);
  let opened;
  assert.equal((await openOriginProject(path,{openPath:async actual=>{opened=actual;return '';}})).opened,true);assert.equal(opened,path);
  assert.throws(()=>validateOriginProject(Buffer.concat([Buffer.from('MZ'),Buffer.alloc(200)]),'fake.opju'),/有效/);
  assert.throws(()=>validateOriginProject(bytes,'payload.exe'),/有效/);
  await assert.rejects(()=>openOriginProject(path,{openPath:async()=> 'no association'}),/no association/);
 }finally{await rm(root,{recursive:true,force:true});}
});
