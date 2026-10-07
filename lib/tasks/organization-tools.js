import {defineTool} from '@deepseek-ai/dsh-tools';
import {resolveToolProjectId} from '../project-context.js';
import {cleanJson} from '../../src/json-boundary.js';
export function registerOrganizationTools(ctx){
 for(const [name,description,parameters,run] of [
  ['lab_tasks_list_reading_folders','列出当前课题已有精读文件夹，以及可分类报告的 Markdown 路径。分类前读取报告，优先复用同主题文件夹。',{projectId:{type:'string'}},async(service,args)=>({folders:service.listReadingFolders(args.projectId),reports:service.listReadingReports(args.projectId).filter(row=>row.paperCardPath&&row.docxPath).map(row=>({reportId:row.id,folderId:row.folderId,title:row.titleZh??row.shortCitation,path:row.paperCardPath,classification:row.classification}))})],
  ['lab_tasks_classify_reading_report','根据已精读报告内容把条目归入文件夹。先读取报告与已有文件夹；用简洁主题名，优先复用同主题文件夹。没有合适文件夹时传 name 自动创建。必须给出基于报告的分类理由，不得仅凭题名/摘要猜测。',{projectId:{type:'string'},reportId:{type:'string',required:true},folderId:{type:'string',description:'已有文件夹编号，与 name 二选一'},name:{type:'string',description:'Agent 判断的主题文件夹名称，与 folderId 二选一'},reason:{type:'string',required:true,description:'引用报告内容说明分类依据'}},async(service,args)=>{
   if(Boolean(args.folderId)===Boolean(args.name))throw Error('folderId 与 name 需且只能提供一个');
   const report=await service.classifyReadingReport({...args,source:'agent'});return {reportId:report.id,folderId:report.folderId};
  }]
 ])ctx.tools.register(defineTool({name,description,parameters,output:{schema:{type:'object',additionalProperties:false,properties:{ok:{type:'boolean',required:true},error:{type:'string'},data:{type:'object',additionalProperties:true}}},render:(_args,value)=>[{type:'text',text:value.ok?JSON.stringify(value.data):value.error}]},timeoutMs:30000,async execute(args,exec){try{const resolved=resolveToolProjectId(ctx,args,exec);if(resolved.error)throw Error(resolved.error);return {ok:true,data:cleanJson(await run(ctx.get?.('ibmLiteratureWorkflows')??ctx.labTasks,{...args,projectId:resolved.projectId}))};}catch(error){return {ok:false,error:error.message};}}}));
}
