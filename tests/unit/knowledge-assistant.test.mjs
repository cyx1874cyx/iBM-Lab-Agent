import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installKnowledgeAssistant} from '../../lib/knowledge-assistant.js';
import {readingTransferRequested,transferAuthorized} from '../../plugins/knowledge/lib/reading.js';

function fixture({bound=true,rag=true,empty=false,failed=false}={}){
 const handlers={};const calls=[],writes=[],chat={settings:{keys:['shared:a:b'],role:'original'},lastQuestion:'电阻抗如何检测血栓？'};
 const result={query:'q',sources:empty?[]:[{citationId:'S1',fileName:'paper.pdf',knowledgeBaseName:'文献',locator:{kind:'pdf',page:2},snippet:'Measured impedance.'}]};
 const service={chatState:async()=>({chat:rag?chat:null}),chatWrite:async(_p,_s,update)=>{writes.push(update);},search:async request=>{calls.push(request);if(failed)throw Error('Index unreadable');return result;}};
 const knowledgeStub={forCore:()=>service,readingTransferRequested,transferAuthorized};
 installKnowledgeAssistant({get:name=>name==='labKnowledge'?knowledgeStub:{getProjectBySession:()=>bound?{project:{id:'project-a'}}:null},on:(name,value)=>{handlers[name]=value;}},{serviceFor:()=>service,readAccess:{safeFile:async(_project,path)=>{if(path!=='report.md')throw Error('仅允许项目资料');return{actual:'/project/report.md'};}}});
 return {calls,writes,execute:(name,args,next)=>handlers['tools/execute']({name,arguments:args,agent:{session:{id:'session-a'}}},next),assemble:()=>handlers['system-prompt/assemble']({}, {agent:{session:{id:'session-a'}}},async()=>({tools:['bash','write','lab_research_read','read','read_image','lab_project_memory_read','lab_tasks_register_report','lab_knowledge_search','lab_knowledge_add_to_reading'].map(name=>({name})),sections:[{name:'research',text:'Run tasks'}],contexts:[{name:'workspace',text:'files'}],variables:{model:'configured'}})),invoke:(question='研究主要结论？',options={})=>handlers['agent/pre-step']({agent:{session:{id:'session-a'}},turn:3,step:1,signal:new AbortController().signal,...options},async()=>({kind:'enter',messages:question?[{id:'q',role:'user',source:{kind:'user'},content:[{type:'text',text:question}]}]:[]}))};
}
test('knowledge assistant retrieves before model admission on first question and follow-up, with linked source notices',async()=>{
 const f=fixture();const answer=await f.invoke('它的样本量是多少？');assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].keys,['shared:a:b']);assert.match(f.calls[0].query,/电阻抗如何检测血栓/);assert.match(f.calls[0].query,/样本量/);
 assert.equal(answer.messages[0].content[0].text,'它的样本量是多少？');assert.equal(answer.messages[1].source.form,'notice');assert.match(answer.messages[1].content[0].text,/#ibm-rag-3-S1/);assert.match(answer.messages[1].content[0].text,/不可信/);assert.equal(f.writes.at(-1).retrievalStatus,'ready');
 await f.invoke('不同材料的导电性比较？',{turn:4});assert.equal(f.calls.length,2);
});
test('empty evidence and retrieval failures cannot silently fall back to generic answering',async()=>{
 for(const settings of [{empty:true},{failed:true}]){const f=fixture(settings),answer=await f.invoke();assert.match(answer.messages[1].content[0].text,/没有可用知识库检索证据/);assert.match(answer.messages[1].content[0].text,/不要用历史答案或模型常识/);assert.match(answer.messages[1].content[0].text,/继续使用只读工具查询/);assert.equal(f.writes.at(-1).retrievalStatus,settings.failed?'failed':'empty');}
});
test('ordinary research conversations and tool continuation steps do not enter RAG mode',async()=>{
 for(const settings of [{bound:false},{rag:false}]){const f=fixture(settings);assert.equal((await f.invoke()).messages.length,1);assert.equal(f.calls.length,0);}
 const f=fixture();assert.equal((await f.invoke(null)).messages.length,0);assert.equal(f.calls.length,0);
});
test('dedicated Q&A exposes cross-module reads without granting commands or general write tools',async()=>{
 const dedicated=await fixture().assemble();assert.deepEqual(dedicated.tools.map(tool=>tool.name),['lab_research_read','read','read_image','lab_project_memory_read','lab_knowledge_search','lab_knowledge_add_to_reading']);assert.deepEqual(dedicated.contexts,[]);assert.equal(dedicated.variables.model,'configured');assert.match(dedicated.sections[0].text,/知识库问答助手/);assert.match(dedicated.sections[0].text,/试剂清单/);
 assert.equal((await fixture({rag:false}).assemble()).tools[0].name,'bash');
});

test('knowledge read permissions are enforced at dispatch, including hallucinated tools and file scope',async()=>{
 const f=fixture();let dispatched=0;const next=async()=>{dispatched++;return{isError:false};};
 for(const name of ['bash','write','edit','lab_tasks_delete_bundle','lab_project_memory_update','lab_characterization_submit','run_code']){
  const result=await f.execute(name,{},next);assert.equal(result.isError,true,name);assert.match(result.error.message,/只读/);
 }
 assert.equal(dispatched,0);
 assert.equal((await f.execute('read',{file_path:'../outside.txt'},next)).isError,true);assert.equal(dispatched,0);
 await f.execute('read',{file_path:'report.md'},next);await f.execute('lab_research_read',{resource:'reagents'},next);assert.equal(dispatched,2);
 await fixture({rag:false}).execute('write',{},next);assert.equal(dispatched,3,'normal research conversations keep their existing capabilities');
});
test('explicit transfer requests preserve the earlier evidence and expose the supported action instead of refusing writes',async()=>{
 const f=fixture();const result=await f.invoke('把前面这几篇文献加入精读条目的一个新文件夹');assert.equal(f.calls.length,0);assert.match(result.messages[1].content[0].text,/lab_knowledge_add_to_reading/);assert.doesNotMatch(result.messages[1].content[0].text,/也不修改项目文件/);
});
