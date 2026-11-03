import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {runPlotJob} from '../../src/runtime/plot-job.js';
const python=process.env.IBM_PLOT_TEST_PYTHON;
test('real parser handles Chinese CSV, missing values, Excel sheets and explicit header rows without altering the input',{skip:!python,timeout:45000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-plot-table-'));
 const spawnImpl=(command,args,options)=>spawn(command,args,{...options,env:{...process.env,...options.env},windowsHide:true,stdio:['ignore','pipe','pipe']});
 const inspect=(path,fields={})=>runPlotJob({command:python,cwd:root},'inspect',{path,output:join(root,'parsed'),...fields},{spawnImpl});
 try{
  const path=join(root,'中文.csv'),raw=Buffer.from('\ufeff时间 (s),强度,样本\r\n0,1,A\r\n1,,B\r\n2,3,C\r\n');await writeFile(path,raw);
  const profile=await inspect(path);assert.equal(profile.sheet,'数据');assert.equal(profile.columns[0].name,'时间 (s)');assert.equal(profile.columns[1].missing,1);assert.equal(profile.columns[2].type,'category');assert.equal(profile.sample[1][1],null);assert.deepEqual(await readFile(path),raw);
  const book=join(root,'数据.xlsx');
  const created=spawnSync(python,['-I','-c',"from openpyxl import Workbook; import sys; w=Workbook(); s=w.active; s.title='说明'; s.append(['说明']); s.append(['此页没有绘图数据']); s=w.create_sheet('实验'); [s.append(r) for r in [['时间','信号'],[0,1],[1,4],[2,9]]]; w.save(sys.argv[1])",book],{windowsHide:true,encoding:'utf8'});assert.equal(created.status,0,created.stderr);
  const bytes=await readFile(book);
  const excel=await inspect(book,{sheet:'实验'});assert.deepEqual(excel.sheets,['说明','实验']);assert.equal(excel.sheet,'实验');assert.equal(excel.rows,3);assert.equal(excel.columns[1].type,'number');assert.deepEqual(await readFile(book),bytes);
  const metadata=join(root,'metadata.csv');await writeFile(metadata,'仪器记录,编号\nTime,Signal\n0,2\n1,5\n');const adjusted=await inspect(metadata,{headerRow:1});assert.equal(adjusted.columns[0].name,'Time');assert.equal(adjusted.rows,2);
  const noheader=join(root,'noheader.tsv');await writeFile(noheader,'0\t1\n1\t2\n');const plain=await inspect(noheader,{headerRow:-1});assert.equal(plain.rows,2);assert.equal(plain.columns[0].name,'Column 1');
  await assert.rejects(()=>inspect(book,{sheet:'不存在'}),/工作表不存在/);
 }finally{await rm(root,{recursive:true,force:true});}
});
