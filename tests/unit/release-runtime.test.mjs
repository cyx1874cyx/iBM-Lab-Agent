import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { extractPackageArchive } from '../../electron-next/release-runtime.mjs';

function archive(name,content,type='0'){
 const bytes=Buffer.from(content),header=Buffer.alloc(512);header.write(name);header.write(bytes.length.toString(8).padStart(11,'0'),124);header.write(type,156);
 return gzipSync(Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512),Buffer.alloc(1024)]));
}
test('release archive extraction keeps exact package bytes in a Chinese path',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-release-'));
 try{const target=join(dir,'中文目录');extractPackageArchive(archive('package/lib/note.txt','fixture bytes'),target);assert.equal(readFileSync(join(target,'lib/note.txt'),'utf8'),'fixture bytes');}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('release extraction rejects traversal, external archive entries and links',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ibm-release-'));
 try{for(const [name,type] of [['package/../escape','0'],['package/C:/escape','0'],['elsewhere/escape','0'],['package/link','2']])assert.throws(()=>extractPackageArchive(archive(name,'bad',type),join(dir,'package')));assert.equal(existsSync(join(dir,'escape')),false);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
