import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {EventEmitter} from 'node:events';
import {openInMnova,MNOVA_SHELL_OPEN_SCRIPT} from '../../electron-next/mnova-open.mjs';
import {nativeMcpConfig} from '../../src/runtime/native-applications.js';

test('Mnova file opening uses Windows Shell with installation cwd and opaque data paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-mnova-open-'));
 try{
  const executable=join(root,'MestReNova.exe'),spectrum=join(root,'a space.mnova'),fid=join(root,'sample.fid');
  await writeFile(executable,'fixture');await writeFile(spectrum,'fixture');await mkdir(fid);await writeFile(join(fid,'fid'),'raw');
  const calls=[],launch=(...args)=>{calls.push(args);const child=new EventEmitter();queueMicrotask(()=>child.emit('close',0));return child;};
  assert.equal((await openInMnova(spectrum,{env:{MNOVA_EXE:executable},launch})).opened,true);
  await openInMnova(fid,{env:{MNOVA_EXE:executable},launch});
  assert.match(calls[0][0],/powershell\.exe$/i);assert.deepEqual(calls[0][1],['-NoProfile','-NonInteractive','-Command',MNOVA_SHELL_OPEN_SCRIPT]);
  assert.equal(calls[0][2].cwd,dirname(executable));assert.equal(calls[0][2].env.IBM_MNOVA_OPEN_EXE,executable);assert.equal(calls[0][2].env.IBM_MNOVA_OPEN_INPUT,spectrum);assert.equal(calls[1][2].env.IBM_MNOVA_OPEN_INPUT,join(fid,'fid'));
  assert.equal(calls[0][2].shell,undefined);assert.equal(calls[0][2].windowsHide,true);
  assert.match(MNOVA_SHELL_OPEN_SCRIPT,/UseShellExecute = \$true/);assert.match(MNOVA_SHELL_OPEN_SCRIPT,/GetDirectoryName/);assert.doesNotMatch(MNOVA_SHELL_OPEN_SCRIPT,/runas|WaitForExit/i);
  await assert.rejects(openInMnova('relative.mnova',{launch}),/路径无效/);
  const invalid=join(root,'bad.txt');await writeFile(invalid,'fixture');await assert.rejects(openInMnova(invalid,{launch}),/无法/);
  const failed=[],failLaunch=(...args)=>{failed.push(args);const child=new EventEmitter();queueMicrotask(()=>child.emit('close',1));return child;};
  await assert.rejects(openInMnova(spectrum,{env:{MNOVA_EXE:executable},launch:failLaunch}),/Windows Shell/);assert.equal(failed.length,1,'never fall back to launching MestReNova directly');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Mnova bridge scripts use a stable per-project temporary path; data and output stay in the project',()=>{
 const workspace=join(tmpdir(),'中文工程','核磁数据'),config=nativeMcpConfig('mnova',{python:process.execPath,workspaceRoot:workspace});
 assert.equal(config.cwd,workspace);assert.equal(config.env.MNOVA_MCP_WORKSPACE,workspace);assert.equal(config.env.MNOVA_MCP_OUTPUT_ROOT,join(workspace,'mnova-output'));
 assert.equal(dirname(config.env.MNOVA_MCP_RUNTIME_ROOT),join(tmpdir(),'ibm-mnova-runtime'));assert.match(config.env.MNOVA_MCP_RUNTIME_ROOT.split(/[\\/]/).at(-1),/^[a-f0-9]{16}$/);
 assert.equal(config.env.MNOVA_MCP_RUNTIME_ROOT,nativeMcpConfig('mnova',{python:process.execPath,workspaceRoot:workspace}).env.MNOVA_MCP_RUNTIME_ROOT);
 assert.notEqual(config.env.MNOVA_MCP_RUNTIME_ROOT,nativeMcpConfig('mnova',{python:process.execPath,workspaceRoot:workspace+'2'}).env.MNOVA_MCP_RUNTIME_ROOT);
});
