import {access,stat} from 'node:fs/promises';
import {join,dirname,extname,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';

// Match the existing Python bridge's ShellExecuteExW launch: the installed GUI
// starts through Windows Shell, with its installation directory as working directory.
// User paths are environment values, never interpolated into PowerShell code.
export const MNOVA_SHELL_OPEN_SCRIPT=`$ErrorActionPreference = 'Stop'
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = $env:IBM_MNOVA_OPEN_EXE
$info.WorkingDirectory = [System.IO.Path]::GetDirectoryName($info.FileName)
$info.UseShellExecute = $true
$info.Verb = 'open'
$info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
$info.Arguments = '"' + $env:IBM_MNOVA_OPEN_INPUT + '"'
$opened = [System.Diagnostics.Process]::Start($info)
if ($null -ne $opened) { $opened.Dispose() }
`;

export async function openInMnova(path,{env=process.env,launch=spawn}={}){
 if(!isAbsolute(path)||/["\r\n\0]/.test(path))throw Error('核磁文件路径无效');
 const info=await stat(path);
 let input=path;
 if(info.isDirectory()){
  try{await access(join(path,'fid'));input=join(path,'fid');}
  catch{await access(join(path,'ser'));input=join(path,'ser');}
 }else if(!['.mnova','.jdx','.dx','.jcamp'].includes(extname(path).toLowerCase()))throw Error('无法在 Mnova 中打开该核磁文件');
 const candidates=[env.MNOVA_EXE,...[env.ProgramFiles,env['ProgramFiles(x86)'],'C:/Program Files'].filter(Boolean).map(root=>join(root,'Mestrelab Research S.L','MestReNova','MestReNova.exe')),...(env.PATH||env.Path||'').split(';').filter(Boolean).map(root=>join(root,'MestReNova.exe'))].filter(Boolean);
 let executable;
 for(const candidate of candidates){try{if((await stat(candidate)).isFile()){executable=candidate;break;}}catch{/* optional installation */}}
 if(!executable)throw Error('未找到 Mnova，请安装 MestReNova 或配置 MNOVA_EXE');
 const powershell=join(env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 await new Promise((resolve,reject)=>{
  const child=launch(powershell,['-NoProfile','-NonInteractive','-Command',MNOVA_SHELL_OPEN_SCRIPT],{cwd:dirname(executable),windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...env,IBM_MNOVA_OPEN_EXE:executable,IBM_MNOVA_OPEN_INPUT:input}});
  let stderr='',settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(Error('Windows Shell 启动 Mnova 超时'));},15000);
  child.stderr?.on('data',bytes=>{stderr=(stderr+bytes).slice(-2000);});
  child.once('error',error=>finish(error));
  child.once('close',code=>finish(code===0?null:Error('Windows Shell 无法启动 Mnova：'+(stderr.trim()||'退出码 '+code))));
 });
 return {opened:true,application:'mnova',launchChannel:'windows-shell'};
}
