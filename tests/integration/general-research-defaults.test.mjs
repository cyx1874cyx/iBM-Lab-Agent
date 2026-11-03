import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootLite} from '../helpers/boot-lite.mjs';
import legacyNotes from '../../src/legacy-note-defaults.json' with {type:'json'};
import {createDefaultResearchGoal,projectReadingGoal} from '../../src/goal-profile.js';
import {noteTemplateKey} from '../../src/note-template.js';

test('generic defaults do not impose a discipline and preserve explicit project goals',()=>{
 const goal=createDefaultResearchGoal();
 assert.deepEqual(goal.topics,[]);
 assert.doesNotMatch(JSON.stringify(goal),/聚前药|高分子|载药量|polymer|prodrug/i);
 assert.equal(projectReadingGoal({goalProfile:{id:'default-prodrug-polymer',version:'1'}}).id,goal.id);
 assert.deepEqual(projectReadingGoal({goalProfile:{id:'my-topic',version:'3'}}),{id:'my-topic',version:'3'});
});

test('untouched shipped templates receive a generic version; historical and customized templates stay intact',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-general-defaults-'));let handle;
 try{
  handle=await bootLite({storageRoot:join(dir,'storage'),includePython:false,coreOnly:true,extraRows:[{id:'notes',name:'dsh-lab-agent/note-templates'}]});
  const notes=handle.ctx.labNoteTemplates,table=notes.requireTable();
  for(const row of legacyNotes)await table.put(noteTemplateKey(row.id,row.version),row);
  await Promise.all([notes.list(),notes.list('review')]);
  await notes.ensureSeed();
  for(const old of legacyNotes){
   assert.deepEqual(table.get(noteTemplateKey(old.id,'1')),old,'historical version remains immutable');
   const current=await notes.resolve(old.id);
   assert.equal(current.version,'2');
   assert.deepEqual(current.topics,[]);
   assert.doesNotMatch(JSON.stringify(current),/聚前药|高分子|载药量|Mn\/DP/);
   assert.equal(notes.rowsFor(old.id).length,2,'upgrade is idempotent');
  }
  // Model an installation that already edited its shipped v1 definition.
  for(const old of legacyNotes){
   await table.delete(noteTemplateKey(old.id,'2'));
   await table.put(noteTemplateKey(old.id,'1'),{...old,name:'我的课题专用模板'});
  }
  await notes.ensureSeed();
  for(const old of legacyNotes){
   assert.equal((await notes.resolve(old.id)).name,'我的课题专用模板');
   assert.equal(notes.rowsFor(old.id).length,1);
  }
  for(const old of legacyNotes){
   await notes.deleteProfile(old.id);
   const historical=structuredClone(table.get(noteTemplateKey(old.id,'1')));
   await notes.ensureSeed();
   assert.deepEqual(table.get(noteTemplateKey(old.id,'1')),historical,'deleted templates keep their original history');
   assert.equal(await notes.resolve(old.id),undefined,'deleted defaults remain deleted');
  }
 }finally{await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});
