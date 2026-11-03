import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEGACY_RESEARCH_IDENTITY,generalizeResearchIdentity} from '../../src/runtime/research-identity.js';

test('pinned legacy conversations receive the generic identity without changing stored or custom prompts',()=>{
 const custom={name:'custom',text:'课题方向：高分子材料，关注用户指定的问题。'};
 const assembly={sections:[{name:'persona',text:`${LEGACY_RESEARCH_IDENTITY}，运行于 H:/project。\n证据必须来自原文。`},custom],tools:[{name:'a'}],contexts:[]};
 const updated=generalizeResearchIdentity(assembly);
 assert.match(updated.sections[0].text,/iBM Lab 通用科研助手/);
 assert.match(updated.sections[0].text,/运行于 H:\/project。\n证据必须来自原文。/);
 assert.ok(assembly.sections[0].text.includes(LEGACY_RESEARCH_IDENTITY));
 assert.equal(updated.sections[1],custom);
 assert.equal(updated.tools,assembly.tools);
 assert.equal(generalizeResearchIdentity(updated),updated,'idempotent');
});
