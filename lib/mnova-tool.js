import {defineTool} from '@deepseek-ai/dsh-tools';
import {isDesktopShell} from './capabilities.js';
import {resolveToolProjectId} from './project-context.js';

const string=(required=false)=>({type:'string',...(required?{required:true}:{})});
const boolean={type:'boolean'};
const definitions=[
 ['mnova_status','检查已安装 Mnova 与桥接模块，不启动分析。',{}],
 ['mnova_probe_runtime','通过正常交互窗口只读检查 NMR 模块与输入文件，不处理或保存谱图。',{input_path:string(true)}],
 ['mnova_process_1d','使用 Mnova 处理一维核磁，保留原始文件。',{input_path:string(true),output_dir:string(),processing_template_path:string()}],
 ['mnova_prepare_structure_1d','同时读取核磁数据和目标结构，在 Mnova 生成本次指认依据与 prepared.mnova。',{input_path:string(true),structure_path:string(true),output_dir:string(),processing_template_path:string(),run_verification:boolean}],
 ['mnova_apply_assignments_1d','根据本次 prepared.mnova 和独立指认计划写入标峰，保存新的 assigned.mnova。',{prepared_mnova_path:string(true),assignment_plan_path:string(true),output_dir:string(),run_verification:boolean,allow_low_confidence:boolean}],
];

export function registerMnovaTools(ctx){
 if(!isDesktopShell())return;
 for(const [name,description,parameters] of definitions)ctx.tools.register(defineTool({
  name,description,parameters:{projectId:string(),...parameters},timeoutMs:360000,
  output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
  async execute(args,exec){
   try{
    const target=resolveToolProjectId(ctx,args,exec);if(target.error)throw Error(target.error);
    const {projectId:_projectId,...fields}=args;
    return await ctx.get('ibmRuntime').mnova(target.projectId,name,fields,{signal:exec?.signal});
   }catch(error){return {ok:false,error:error.message};}
  }
 }));
}
