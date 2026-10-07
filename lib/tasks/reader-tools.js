import {defineTool} from '@deepseek-ai/dsh-tools';
import {resolveToolProjectId} from '../project-context.js';
import {cleanJson} from '../../src/json-boundary.js';
export function registerReaderTools(ctx){
 const identity={projectId:{type:'string'},bundleId:{type:'string',required:true},kind:{type:'string',enum:['pdf','si']},translationId:{type:'string',required:true}};
 for(const [name,description,parameters,operation] of [
  ['lab_reader_translation_start','为当前课题已归档 PDF 启动全文翻译，kind=pdf 正文、si 补充材料。返回 translationId；随后 prepare，再分批 read/write，最后 finish。',{projectId:identity.projectId,bundleId:identity.bundleId,kind:identity.kind},'translationCreate'],
  ['lab_reader_translation_prepare','解析 PDF 为带页码与编号的全文块。支持恢复已有译文。必须逐块翻译，不能以摘要代替全文。',identity,'translationPrepare'],
  ['lab_reader_translation_read','分批读取原文块与已写入的译文。pendingOnly=true 返回未完成块，每批处理后再次读 offset=0，直到 total=0；扫描块先读取 imagePath 图像完整转写再翻译。',{...identity,offset:{type:'number'},limit:{type:'number'},pendingOnly:{type:'boolean'}},'translationRead'],
  ['lab_reader_translation_write','保存逐块完整中文译文。保留数字、化学式、公式、引用编号和原意；不得遗漏段落、图注、方法、参考文献。扫描页提供完整 original 转写；不确定处用 note 标注。',{...identity,blocks:{type:'array',required:true,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',required:true},zh:{type:'string',required:true},original:{type:'string'},note:{type:'string'}}}}},'translationWrite'],
  ['lab_reader_translation_finish','全部全文块翻译完成并复核后归档。工具会拒绝遗漏、源 PDF 更新。notes 记录术语、扫描识别与不确定性。',{...identity,notes:{type:'string'}},'translationFinish'],
  ['lab_reader_translation_cancel','取消当前翻译，保留已翻译块供重试恢复。',identity,'translationCancel'],
 ])ctx.tools.register(defineTool({name,description,parameters,timeoutMs:180000,output:{schema:{type:'object',additionalProperties:false,properties:{ok:{type:'boolean',required:true},error:{type:'string'},data:{type:'object',additionalProperties:true}}},render:(_args,value)=>[{type:'text',text:value.ok?JSON.stringify(value.data):value.error}]},async execute(args,exec){try{const project=resolveToolProjectId(ctx,args,exec);if(project.error)throw Error(project.error);const service=ctx.get?.('ibmLiteratureWorkflows')??ctx.labTasks;return {ok:true,data:cleanJson(await service[operation]({...args,projectId:project.projectId,sessionId:exec.agent?.session?.header?.id}))};}catch(error){return {ok:false,error:error.message};}}}));
}
