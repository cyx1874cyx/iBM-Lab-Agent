import {defineTool} from '@deepseek-ai/dsh-tools';
import {resolveToolProjectId} from './project-context.js';
import {cleanJson} from '../src/json-boundary.js';

export function registerPlotEditorTools(ctx){
 for(const editing of [false,true])ctx.tools.register(defineTool({
  name:editing?'lab_plot_editor_apply':'lab_plot_editor_state',
  description:editing?'按用户要求修改已选图的对象配置，调用 Origin 生成更新后的工程和图片草稿并等待结果。支持逐系列、文本、轴、图例、标注及多面板；使用此前 state 返回的 spec 作基础。需要视觉检查时，用 read_image 打开结果中 originPreview.path；正式保存由用户确认。':'读取当前课题绘图条目及可编辑对象；提供 recordId 时返回其列映射、配置和 Origin 图稿信息。需要查看图像时用 read_image 打开 originPreview.path。',
  parameters:{projectId:{type:'string'},recordId:{type:'string',...(editing?{required:true}:{})},...(editing?{patch:{type:'object',required:true,additionalProperties:true}}:{})},
  output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},timeoutMs:120000,
  async execute(args,exec){
   try{
    const target=resolveToolProjectId(ctx,args,exec);if(target.error)throw Error(target.error);
    const service=ctx.get('labPlotRecords');if(!service)throw Error('科研绘图服务尚未就绪');
    if(!args.recordId)return cleanJson({ok:true,records:(await service.list(target.projectId)).map(row=>({id:row.id,title:row.topic,status:row.workflow?.status}))});
    const row=await service.plotEntry(target.projectId,args.recordId),w=row.workflow;
    if(!editing)return cleanJson({ok:true,recordId:row.id,status:w.status,spec:w.spec||w.savedSpec,columns:w.profile?.columns,source:w.raw.fileName,originPreview:service.plotPreviews?.get(row.id)?.current||w.draft?.preview||w.saved?.preview});
    if(!w.spec&&!w.savedSpec)throw Error('请先让用户选择图样式并生成初版');
    const queued=await service.plotRender({projectId:target.projectId,id:row.id,spec:{...(w.spec||w.savedSpec),...args.patch},revision:w.revision,save:false});
    const job=service.plotJobs.get(row.id)?.job;if(job)await job;
    const result=await service.plotEntry(target.projectId,row.id),next=result.workflow;
    if(next.operation!==queued.record.workflow.operation)throw Error('绘图修改已被新的操作替代，请检查条目状态');
    if(next.status!=='editing'||!next.draft)return {ok:false,recordId:row.id,status:next.status,error:next.error||'Origin 修改未完成',message:'已保存的工程未被替换。'};
    return cleanJson({ok:true,recordId:row.id,status:next.status,originPreview:next.draft.preview,originProject:next.draft.origin,consistency:next.draft.readback?.consistency,message:'Origin 已生成修改后的图和工程草稿；正式保存由用户确认。'});
   }catch(error){return {ok:false,error:error.message};}
  }
 }));
 ctx.tools.register(defineTool({
  name:'lab_plot_origin_refine',
  description:'对指定绘图条目生成 Origin 精修候选并等待结果。仅建议图例和图标题位置，暂停轴标题精修；候选须由用户并排视觉核对后确认保存，原工程在确认前不变。位置读回不能证明没有重叠。',
  parameters:{projectId:{type:'string'},recordId:{type:'string',required:true}},
  output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},timeoutMs:300000,
  async execute(args,exec){
   try{
    const target=resolveToolProjectId(ctx,args,exec);if(target.error)throw Error(target.error);
    const service=ctx.get('labPlotRecords');if(!service)throw Error('科研绘图服务尚未就绪');
    const row=await service.plotEntry(target.projectId,args.recordId);
    const queued=await service.plotRefine({projectId:target.projectId,id:row.id,revision:row.workflow.revision});
    const job=service.plotJobs.get(row.id)?.job;if(job)await job;
    const result=await service.plotEntry(target.projectId,row.id),w=result.workflow;
    if(w.operation!==queued.record.workflow.operation)throw Error('精修操作已被新的操作替代，请检查条目状态');
    if(w.status!=='editing'||!w.pendingRefinement)return {ok:false,recordId:row.id,status:w.status,error:w.error||'精修未完成',message:'原工程已保留。'};
    return cleanJson({ok:true,recordId:row.id,status:w.status,refinement:w.pendingRefinement.refinement,consistency:w.draft?.readback?.consistency,message:'已生成待核对候选，原工程未变；请用户在绘图条目中并排核对，重点检查文字重叠，再自行决定是否确认保存。'});
   }catch(error){return {ok:false,error:error.message};}
  }
 }));
}
