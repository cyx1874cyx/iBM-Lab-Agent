import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {nmrDropFiles,isNmrData,isNmrStructure} from '../../client/src/nmr-files.js';

test('NMR folder drop retains nested acquisition files and reads all directory batches',async()=>{
 const fileEntry=(name,content)=>({name,isFile:true,file:resolve=>resolve(new File([content],name))});
 const directory=(name,batches)=>({name,isDirectory:true,createReader:()=>{let index=0;return {readEntries:resolve=>resolve(batches[index++]||[])};}});
 const root=directory('sample.fid',[[fileEntry('fid','raw')],[fileEntry('procpar','acquisition'),directory('pdata',[[fileEntry('1r','processed')]])]]);
 const files=await nmrDropFiles({items:[{webkitGetAsEntry:()=>root}],files:[]});
 assert.equal(files[0].name,'sample.fid.zip');
 const zip=await JSZip.loadAsync(await files[0].arrayBuffer());
 assert.equal(await zip.file('sample.fid/fid').async('string'),'raw');
 assert.equal(await zip.file('sample.fid/procpar').async('string'),'acquisition');
 assert.equal(await zip.file('sample.fid/pdata/1r').async('string'),'processed');
 assert.equal(isNmrData('data.MNOVA'),true);assert.equal(isNmrStructure('target.CDXML'),true);assert.equal(isNmrStructure('report.docx'),false);
});
