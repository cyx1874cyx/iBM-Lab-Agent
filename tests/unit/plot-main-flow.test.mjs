import {test} from 'node:test';import assert from 'node:assert/strict';
import {materializeNumericAxes,manualChartChoices,validatePlotSelection} from '../../src/plot/workspace.js';
test('manual chart choices include every applicable kind even without or with partial invalid AI output',()=>{
 const profile={columns:[{index:0,type:'category',count:4},...[1,2].map(index=>({index,type:'number',count:4,min:1,max:9}))]};
 for(const recommendations of [[],[{kind:'line',xCol:1,yCols:[2],reason:'Trend'}],[{kind:'bar',xCol:0,yCols:[99],reason:'Invalid'}]]){
  const choices=manualChartChoices(profile,recommendations);assert.equal(choices.length,7);
  for(const {kind,xCol,yCols} of choices)assert.doesNotThrow(()=>validatePlotSelection({kind,xCol,yCols},profile));
 }
});
test('bar and column auto ranges contain zero for positive, negative, crossing and constant measurements',()=>{
 for(const kind of ['column','bar'])for(const [lo,hi] of [[2,8],[-8,-2],[-8,2],[-5,-5],[5,5],[0,0]]){
  const profile={columns:[{index:0,type:'category',count:3},{index:1,type:'number',count:3,min:lo,max:hi}]},axis=kind==='bar'?'xAxis':'yAxis';
  const spec=materializeNumericAxes({kind,xCol:0,yCols:[1]},profile);assert.ok(spec[axis].min<=Math.min(0,lo));assert.ok(spec[axis].max>=Math.max(0,hi));assert.ok(spec[axis].max>spec[axis].min);
  const manual=materializeNumericAxes({kind,xCol:0,yCols:[1],[axis]:{min:-4,max:-1}},profile);assert.equal(manual[axis].min,-4);assert.equal(manual[axis].max,-1);
 }
});
