import {readFile,stat} from 'node:fs/promises';
import {extname,isAbsolute} from 'node:path';

export function validateOriginProject(bytes,name){
 if(!['.opju','.opj'].includes(extname(name||'').toLowerCase())||bytes.length<100||!/^CPYU?A [0-9.]+ /.test(bytes.subarray(0,40).toString('ascii')))throw Error('不是有效的 Origin 工程文件（OPJU/OPJ）');
}

/** The backend resolves an entry identity; open its real archived file. */
export async function openOriginProject(path,{openPath}={}){
 if(typeof path!=='string'||!isAbsolute(path)||/[\0\r\n]/.test(path)||!(await stat(path)).isFile())throw Error('Origin 工程文件不存在');
 validateOriginProject(await readFile(path),path);
 const error=await openPath(path);if(error)throw Error('无法用 Origin 打开工程：'+error);
 return {opened:true,application:'origin'};
}
