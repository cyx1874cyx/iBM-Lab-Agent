import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReagentWorkbook} from '../../src/reagents/workbook.js';
import {reagentWorkbook,reagentFixtureSheets} from '../helpers/reagent-workbook.mjs';

test('source exports with A1 dimensions retain all rows, sections, duplicate bottles and original values',async()=>{
 const parsed=await parseReagentWorkbook(await reagentWorkbook(reagentFixtureSheets),{id:'chemical',kind:'chemical',fileName:'chemical.xlsx'});
 assert.equal(parsed.records.length,6);assert.equal(parsed.sheets.length,2);
 const first=parsed.records[0];assert.equal(first.row,3);assert.equal(first.location,'小冰箱 · 4℃上1');assert.equal(first.quantity,'0');assert.equal(first.used,false);
 assert.equal(parsed.records[1].used,true);assert.equal(parsed.records[1].name,first.name);assert.notEqual(parsed.records[1].id,first.id);
 assert.equal(parsed.records[2].name,'未填写名称');assert.equal(parsed.records[2].cas,'9004-32-4');
 assert.equal(parsed.records[3].name,'木瓜蛋白酶','a name-only reagent is not discarded as a storage heading');
 assert.equal(parsed.records[4].cas,'2023-03-15');assert.equal(parsed.records[4].casAsDate,true);assert.equal(parsed.records[4].fields.find(f=>f.label==='CAS').note,'源表以日期存储');
 assert.equal(parsed.records[5].name,'磷酸','mistyped source name header preserves adjacent CAS layout');
});
