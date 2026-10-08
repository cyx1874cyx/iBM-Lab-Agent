import {defineTool} from '@deepseek-ai/dsh-tools';
import {resolveToolProjectId} from '../project-context.js';
import {cleanJson} from '../../src/json-boundary.js';
export function registerReaderTools(ctx){
 const identity={projectId:{type:'string'},bundleId:{type:'string',required:true},kind:{type:'string',enum:['pdf','si']},translationId:{type:'string',required:true}};
 for(const [name,description,parameters,operation] of [
  ['lab_reader_translation_start','为当前课题已归档 PDF 启动全文翻译，kind=pdf 正文、si 补充材料。improve=true 新建优化任务并保留旧 PDF。返回 translationId；随后 prepare，再分批 read/write，最后 finish。',{projectId:identity.projectId,bundleId:identity.bundleId,kind:identity.kind,improve:{type:'boolean'}},'translationCreate'],
  ['lab_reader_translation_prepare','解析 PDF 为带页码与编号的全文块。支持恢复已有译文。必须逐块翻译，不能以摘要代替全文。',identity,'translationPrepare'],
  ['lab_reader_translation_read','分批读取原文、context 前后文与 continuation 跨栏/跨页完整段落。pendingOnly=true 包含未译块与待联合复核片段；每批后读 offset=0 至 total=0。continuation 的全部 fragments 应结合 original 整段翻译，并同批 write 提交所有片段及 reviewedGroups。figure-text 为图片 OCR 文字，结合 imagePath 核实后翻译；扫描块先完整转写。',{...identity,offset:{type:'number'},limit:{type:'number'},pendingOnly:{type:'boolean'}},'translationRead'],
  ['lab_reader_translation_write','保存完整译文，保留数字、化学式、公式、引用和原意。连续段落先整段理解再分配到各原位置，避免遗漏或重复；同批提交全部 fragments 后用 reviewedGroups 标记联合复核。figure-text 可提供纠正的 OCR original；扫描页必须完整转写。不确定处用 note 标注。',{...identity,reviewedGroups:{type:'array',items:{type:'string'}},blocks:{type:'array',required:true,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',required:true},zh:{type:'string',required:true},original:{type:'string'},note:{type:'string'}}}}},'translationWrite'],
  ['lab_reader_translation_finish','全部全文块翻译完成并复核后归档。工具会拒绝遗漏、源 PDF 更新。notes 记录术语、扫描识别与不确定性。',{...identity,notes:{type:'string'}},'translationFinish'],
  ['lab_reader_translation_cancel','取消当前翻译，保留已翻译块供重试恢复。',identity,'translationCancel'],
 ])ctx.tools.register(defineTool({name,description,parameters,timeoutMs:180000,output:{schema:{type:'object',additionalProperties:false,properties:{ok:{type:'boolean',required:true},error:{type:'string'},data:{type:'object',additionalProperties:true}}},render:(_args,value)=>[{type:'text',text:value.ok?JSON.stringify(value.data):value.error}]},async execute(args,exec){try{const project=resolveToolProjectId(ctx,args,exec);if(project.error)throw Error(project.error);const service=ctx.get?.('ibmLiteratureWorkflows')??ctx.labTasks;return {ok:true,data:cleanJson(await service[operation]({...args,projectId:project.projectId,sessionId:exec.agent?.session?.id??exec.agent?.session?.header?.id}))};}catch(error){return {ok:false,error:error.message};}}}));
}
