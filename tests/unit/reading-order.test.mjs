import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveReadingIds,orderedReadingReports} from '../../src/literature/reading-order.js';

test('group moves retain relative order and leave hidden entries in their existing sequence',()=>{
 assert.deepEqual(moveReadingIds(['a','b','c','d','e'],['d','b'],'e','after'),['a','c','e','b','d']);
 assert.deepEqual(moveReadingIds(['a','b','c','d'],['d'],'a','before'),['d','a','b','c']);
 assert.deepEqual(moveReadingIds(['a','b'],['a'],'a'),['a','b']);
 assert.throws(()=>moveReadingIds(['a'],['a'],'missing'),/不存在/);
});

test('new entries appear above a saved manual order without disturbing ordered entries',()=>{
 const rows=[{id:'a',createdAt:'2026-01-01'},{id:'b',createdAt:'2026-01-02'},{id:'new',createdAt:'2026-01-03'}];
 assert.deepEqual(orderedReadingReports(rows).map(row=>row.id),['new','b','a']);
 assert.deepEqual(orderedReadingReports(rows,['a','b','stale']).map(row=>row.id),['new','a','b']);
});
