import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../../plugins/nmr/lib/simulation-tools.js';

test('simulation tools register with an explicit evidence-bearing peak model schema',()=>{
 const registered=[];apply({tools:{register:tool=>registered.push(tool)}});
 const structure=registered.find(tool=>tool.name==='lab_nmr_simulation_structure');
 const simulate=registered.find(tool=>tool.name==='lab_nmr_simulation_run');
 assert.ok(structure);assert.ok(simulate);
 assert.ok(simulate.parameters.required.includes('peakModel'));
 assert.deepEqual(simulate.parameters.properties.peakModel.required,['provenance','peaks']);
 assert.deepEqual(simulate.parameters.properties.peakModel.properties.peaks.items.required,['environmentId','ppm','multiplicity','jHz','evidence']);
});
