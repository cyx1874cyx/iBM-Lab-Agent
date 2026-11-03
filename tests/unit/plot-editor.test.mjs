import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plotSpecSchema,validatePlotSelection} from '../../src/plot/workspace.js';
import {registerPlotEditorTools} from '../../lib/plotting-tool.js';
import {seriesColor,updateSeries} from '../../src/plot/editor.js';

test('chart-specific series controls survive schema round trips and keep source-column identities',()=>{
 for(const kind of ['line','line_symbol','scatter','column','bar','box','histogram']){
  const column=4,spec=plotSpecSchema.parse({kind,xCol:0,yCols:[2,4],palette:'warm',series:[{column,color:'#125FB8',fillColor:'#168C60',borderColor:'#314159',symbolFill:'open',symbolEdgeWidth:25,barGap:40,boxWidth:32,binWidth:10,opacity:.7,visible:false}]});
  assert.deepEqual(plotSpecSchema.parse(JSON.parse(JSON.stringify(spec))),spec);
  assert.equal(seriesColor(spec,4),'#125FB8');assert.equal(seriesColor(spec,2),'#000000');
  const next=updateSeries(spec,column,{fillColor:'#B36110'});assert.equal(next[0].column,4);assert.equal(next[0].color,'#125FB8');assert.equal(next[0].fillColor,'#B36110');
  for(const invalid of [{fillColor:'red;exit;'}, {binWidth:0},{boxWidth:-1},{barGap:101},{symbolEdgeWidth:101}])assert.throws(()=>plotSpecSchema.parse({...spec,series:[{column,...invalid}]}));
 }
});

test('object edits validate source identities, native value ranges and panel bounds',()=>{
 const profile={columns:[0,1,2].map(index=>({index,type:'number',count:3,min:1,max:3}))};
 const spec={kind:'line_symbol',xCol:0,yCols:[1,2],series:[{column:2,color:'#125FB8',symbolKind:3}],annotations:[{id:'note1',kind:'arrow',x:.2,y:.2,x2:.8,y2:.8}],layout:{mode:'panels',columns:2}};
 assert.equal(validatePlotSelection(spec,profile).annotations[0].kind,'arrow');
 assert.throws(()=>validatePlotSelection({...spec,series:[{column:0,color:'#000000'}]},profile),/系列样式/);
 assert.throws(()=>validatePlotSelection({...spec,legendOrder:[1,1]},profile),/图例顺序/);
 assert.throws(()=>plotSpecSchema.parse({...spec,annotations:[{id:'unsafe;script',kind:'text',x:0,y:0}]}));
 assert.throws(()=>plotSpecSchema.parse({...spec,series:[{column:1,color:'red;exit;'}]}));
 assert.throws(()=>validatePlotSelection({...spec,layout:{mode:'panels',panels:[{index:0,left:80,top:10,width:50,height:50}]}},profile),/面板范围/);
});

test('AI edit tools target an existing project entry and generate only a revision-fenced draft',async()=>{
 const registered=new Map(),calls=[],spec=plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1]});let done=false;
 const service={plotJobs:new Map(),list:async()=>[{id:'plot1',topic:'图',workflow:{status:'editing'}}],plotEntry:async(projectId,id)=>{assert.equal(projectId,'p');assert.equal(id,'plot1');return {id,workflow:done?{revision:8,operation:'op',status:'editing',draft:{preview:{path:'image.png'},origin:{path:'figure.opju'}}}:{revision:7,status:'editing',spec,raw:{fileName:'source.csv'},profile:{columns:[]}}};},plotRender:async args=>{calls.push(args);service.plotJobs.set('plot1',{job:Promise.resolve().then(()=>{done=true;})});return {record:{workflow:{operation:'op'}}};}};
 const ctx={tools:{register:tool=>registered.set(tool.name,tool)},get:name=>name==='labPlotRecords'?service:{getProject:id=>id==='p'?{id}:undefined}};
 registerPlotEditorTools(ctx);
 const state=await registered.get('lab_plot_editor_state').execute({projectId:'p',recordId:'plot1'},{});
 assert.equal(state.ok,true);assert.equal(state.spec.kind,'line');
 const result=await registered.get('lab_plot_editor_apply').execute({projectId:'p',recordId:'plot1',patch:{titleText:'Edited title'}},{});
 assert.equal(result.ok,true);assert.equal(result.originProject.path,'figure.opju');assert.equal(calls[0].save,false);assert.equal(calls[0].revision,7);assert.equal(calls[0].spec.titleText,'Edited title');assert.equal(calls[0].spec.xCol,0);
 assert.equal((await registered.get('lab_plot_editor_apply').execute({projectId:'missing',recordId:'plot1',patch:{}},{})).ok,false);
});

test('AI edit reports an Origin rendering failure instead of claiming a draft was made',async()=>{
 const registered=new Map(),spec=plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1]});let done=false;
 const service={plotJobs:new Map(),plotEntry:async()=>({id:'plot1',workflow:done?{operation:'op',status:'failed',error:'Origin 导出失败'}:{revision:2,spec}}),plotRender:async()=>{service.plotJobs.set('plot1',{job:Promise.resolve().then(()=>{done=true;})});return {record:{workflow:{operation:'op'}}};}};
 const ctx={tools:{register:tool=>registered.set(tool.name,tool)},get:name=>name==='labPlotRecords'?service:{getProject:id=>id==='p'?{id}:undefined}};
 registerPlotEditorTools(ctx);
 const result=await registered.get('lab_plot_editor_apply').execute({projectId:'p',recordId:'plot1',patch:{titleText:'test'}},{});
 assert.equal(result.ok,false);assert.match(result.error,/Origin 导出失败/);
});

test('conversation refinement tool waits for the bound entry operation and returns its result',async()=>{
 const registered=new Map(),calls=[];let done=false;
 const service={plotJobs:new Map(),plotEntry:async()=>({id:'plot1',workflow:done?{revision:8,operation:'op',status:'editing',pendingRefinement:{refinement:{before:.2,after:.1}},draft:{readback:{}}}:{revision:7}}),plotRefine:async args=>{calls.push(args);service.plotJobs.set('plot1',{job:Promise.resolve().then(()=>{done=true;})});return {record:{workflow:{operation:'op'}}};}};
 const ctx={tools:{register:tool=>registered.set(tool.name,tool)},get:name=>name==='labPlotRecords'?service:{getProject:id=>id==='p'?{id}:undefined}};
 registerPlotEditorTools(ctx);
 const result=await registered.get('lab_plot_origin_refine').execute({projectId:'p',recordId:'plot1'},{});
 assert.equal(result.ok,true);assert.equal(result.refinement.after,.1);assert.deepEqual(calls,[{projectId:'p',id:'plot1',revision:7}]);
});


test('consistency distinguishes native differences and unavailable evidence',async()=>{
 const {checkOriginConsistency}=await import('../../src/plot/consistency.js');const spec=plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1],xLabel:'Time',yLabel:'Signal',xAxis:{min:0,max:4}});
 assert.equal(checkOriginConsistency(spec,{}).status,'unverified');
 const result={readback:{passed:true,layers:[{properties:{'layer.width':9,'layer.height':8}}],graph:{layers_count:1,layers:[{plots_count:1,axes:{x:{title:'Time',limits:[0,4]},y:{title:'Signal'}}}]}}};
 assert.equal(checkOriginConsistency(spec,result).status,'matched');result.readback.graph.layers[0].axes.x.title='Wrong title';assert.equal(checkOriginConsistency(spec,result).status,'differences');
});


test('Origin refinement only adjusts bounded presentation positions and scores against the original preview',async()=>{
 const {applyOriginRefinement,positionDeviation}=await import('../../src/plot/refinement.js');const original=plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1],titleText:'Figure'});
 const {spec}=applyOriginRefinement(original,{reason:'对齐图例',adjustments:[{object:'legend',dx:-.08,dy:0}]});assert.equal(spec.legendX,original.legendX-.08);assert.deepEqual(spec.yCols,original.yCols);assert.equal(original.legendX,.68);
 assert.throws(()=>applyOriginRefinement(original,{reason:'invalid',adjustments:[{object:'legend',dx:.5}]}));assert.throws(()=>applyOriginRefinement(original,{reason:'invalid',adjustments:[{object:'axis',dx:0}]}));
 const baseline={layers:[{layer:0,positions:[{property:'legend.x',target:.68,signedError:.08}]}]},after={layers:[{layer:0,positions:[{property:'legend.x',target:.6,signedError:.08}]}]};assert.ok(positionDeviation(after,original).score<positionDeviation(baseline,original).score);
});

test('axis title refinements use explicit target coordinates and distinguish them from graph title',async()=>{
 const {applyOriginRefinement,positionDeviation}=await import('../../src/plot/refinement.js');
 const target=plotSpecSchema.parse({kind:'line',xCol:0,yCols:[1],titleText:'',xTitleStyle:{y:1.17},yTitleStyle:{x:-.14}});
 const readback={layers:[{layer:0,positions:[{property:'xb.y',target:1.17,signedError:.1},{property:'yl.x',target:-.14,signedError:-.08}]}]};
 const before=positionDeviation(readback,target);assert.deepEqual(before.rows.map(r=>r.property),['xb.y','yl.x']);assert.ok(Math.abs(before.score-.18)<1e-8);
 const {spec}=applyOriginRefinement(target,{reason:'轴标题位置',adjustments:[{object:'xTitle',dx:0,dy:-.1},{object:'yTitle',dx:.08,dy:0}]});
 assert.ok(Math.abs(spec.xTitleStyle.y-1.07)<1e-8);assert.ok(Math.abs(spec.yTitleStyle.x+.06)<1e-8);assert.equal(spec.titleText,'');
 assert.throws(()=>applyOriginRefinement(target,{reason:'无坐标',adjustments:[{object:'xTitle',dx:.1,dy:0}]}),/未设置可验证/);
});

test('refinement descriptions derive directions from the applied deltas',async()=>{
 const {describeRefinementAdjustments}=await import('../../src/plot/refinement.js');
 assert.equal(describeRefinementAdjustments([{object:'legend',dx:.0712,dy:.0719}]),'图例请求位置向右0.071、向下0.072');
});

test('refinement response parsing accepts one schema-valid JSON object in text and rejects unsafe or ambiguous output',async()=>{
 const {parseRefinementResponse}=await import('../../src/plot/refinement.js');
 const plan={reason:'对齐 {图例}',adjustments:[{object:'legend',dx:-.02,dy:0}]};
 assert.deepEqual(parseRefinementResponse('分析结果：\n```json\n'+JSON.stringify(plan)+'\n```\n完成。'),plan);
 assert.throws(()=>parseRefinementResponse(JSON.stringify({...plan,adjustments:[{object:'legend',dx:1,dy:0}]})),/符合要求/);
 assert.throws(()=>parseRefinementResponse(JSON.stringify(plan)+'\n'+JSON.stringify(plan)),/多个/);
 assert.throws(()=>parseRefinementResponse(''),/没有返回/);
});


test('refinement agent receives both preview images only when the configured route supports image input',async()=>{
 const {plotWorkspaceMethods}=await import('../../lib/plot-workspace.js');let message,saved=0,visual=true;
 let events=[];const handle={agent:{followup:value=>{message=value;events.push({type:'assistant/message',data:{message:{content:[{type:'text',text:'{"reason":"对齐","adjustments":[]}'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}});},whenIdle:async()=>{},session:{snapshotEvents:()=>events}},dispose:async()=>{}};
 const refs=[{attachmentId:'a'.repeat(64),mediaType:'image/png',bytes:100,width:10,height:10},{attachmentId:'b'.repeat(64),mediaType:'image/png',bytes:100,width:10,height:10}];
 const ctx={ibmCore:{requireProject:()=>({workspacePath:'fixture'})},get:name=>({agents:{create:async()=>handle},agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})},llm:{resolveModelInfo:async()=>({inputModalities:visual?['text','image']:['text']})},attachments:{saveImages:async images=>{saved++;assert.equal(images.length,2);return refs;}}}[name])};
 let result=await plotWorkspaceMethods.plotAskRefiner.call({ctx},'p',{},[],new AbortController().signal,{local:Buffer.from('local'),origin:Buffer.from('origin')});assert.equal(result.visual,true);assert.equal(message.content.filter(c=>c.type==='image').length,2);assert.equal(saved,1);
 visual=false;result=await plotWorkspaceMethods.plotAskRefiner.call({ctx},'p',{},[],new AbortController().signal,{local:Buffer.from('local'),origin:Buffer.from('origin')});assert.equal(result.visual,false);assert.equal(message.content.filter(c=>c.type==='image').length,0);assert.equal(saved,1);
});

test('refinement retries malformed output once and validates the new response',async()=>{
 const {plotWorkspaceMethods}=await import('../../lib/plot-workspace.js');let calls=0,events=[];
 const handle={agent:{followup:()=>{calls++;events.push({type:'assistant/message',data:{message:{content:[{type:'text',text:calls===1?'无法解析':'结果如下：\n```json\n{"reason":"对齐","adjustments":[{"object":"legend","dx":-0.02,"dy":0}]}\n```'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}});},whenIdle:async()=>{},session:{snapshotEvents:()=>events}},dispose:async()=>{}};
 const ctx={ibmCore:{requireProject:()=>({workspacePath:'fixture'})},get:name=>({agents:{create:async()=>handle},agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})}}[name])};
 const result=await plotWorkspaceMethods.plotAskRefiner.call({ctx},'p',{},[],new AbortController().signal);assert.equal(calls,2);assert.equal(result.proposal.adjustments[0].dx,-.02);
});
