import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,rename,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReagentCatalog} from '../../src/reagents/catalog.js';
import {reagentWorkbook,reagentFixtureSheets} from '../helpers/reagent-workbook.mjs';

test('catalog searches all lists and follows saved Excel changes without modifying the originals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ibm-reagents-'));
 try{
  const catalog=new ReagentCatalog(join(root,'config')),path=join(root,'chemical.xlsx'),buffer=await reagentWorkbook(reagentFixtureSheets);
  await writeFile(path,buffer);await catalog.setSource('chemical',path);
  const cells=join(root,'cells.xlsx');await writeFile(cells,await reagentWorkbook([{name:'细胞清单',rows:[['货号','细胞名称','存放位置','冻存数量','生长培养基'],['C1','RAW 264.7','-80℃',0,'DMEM+10% FBS']]}]));await catalog.setSource('cells',cells);
  assert.equal((await catalog.search({query:'865-49-6'})).total,2);
  assert.equal((await catalog.search({query:'氘代氯仿 安耐吉'})).total,1);
  assert.equal((await catalog.search({query:'raw264.7'})).records[0].name,'RAW 264.7');
  assert.equal((await catalog.search({query:'A-001'})).total,1);
  assert.equal((await catalog.search({kind:'cells'})).total,1);
  assert.equal((await catalog.search({location:'小冰箱 · 4℃上1',status:'used'})).total,1);
  assert.equal((await catalog.search({limit:2,offset:999})).records.length,1);
  assert.deepEqual(await readFile(path),buffer);
  // Excel commonly replaces a file during Save; continue following the same configured path.
  const replacement=join(root,'saved.xlsx');await writeFile(replacement,await reagentWorkbook([{name:'新柜',rows:[['名称','CAS','品牌'],['新增试剂','123-45-6','更新品牌']]}]));await rename(replacement,path);await utimes(path,new Date(),new Date(Date.now()+2000));
  assert.equal((await catalog.search({query:'新增试剂'})).total,1);
  assert.equal((await catalog.search({query:'865-49-6'})).total,0);
  const restarted=new ReagentCatalog(join(root,'config'));assert.equal((await restarted.search({query:'新增试剂'})).total,1);
  await rm(path);const unavailable=await restarted.search({query:'新增试剂'});assert.equal(unavailable.total,1);assert.equal(unavailable.sources[0].stale,true);assert.match(unavailable.sources[0].error,/不存在/);
  const bad=join(root,'bad.xlsx');await writeFile(bad,'invalid');await assert.rejects(catalog.setSource('chemical',bad));assert.equal((await catalog.source('cells')).path,cells);
 }finally{await rm(root,{recursive:true,force:true});}
});
