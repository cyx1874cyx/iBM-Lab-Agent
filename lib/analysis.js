import { Service } from "@deepseek-ai/cordis";
import {join} from 'node:path';
import {copyFile,writeFile} from 'node:fs/promises';
import {syntheticAssignmentPlan} from '../src/nmr/synthetic-assignment.js';

// The bridge fences timed-out read-only probes, so a single fresh request is
// safe after this specific startup timeout. Never retry a processing failure.
export async function mnovaWithStartupRetry(runtime,projectId,tool,args){
 try{return await runtime.mnova(projectId,tool,args);}
 catch(error){if(!/Mnova (?:在 5 秒内未完成只读启动探针|只读启动探针超时)/.test(String(error?.message||'')))throw error;return await runtime.mnova(projectId,tool,args);}
}

/** Analysis accepts task inputs/chemical snapshots and never requires design or literature. */
export class IbmAnalysisService extends Service {
 static inject = ["ibmCore", "ibmRuntime", "labNmr", "labPlotRecords", "labCharacterization"];
 constructor(ctx) { super(ctx, "ibmAnalysis"); }
 list(projectId) { return this.ctx.labCharacterization.list(projectId); }
 submit(input) { return this.ctx.labCharacterization.submit(input); }
 async simulateNmr(input){
  const result=await this.ctx.labCharacterization.simulateNmr(input);
  if(!input.taskId)return result;
  const workspace=await this.ctx.ibmCore.ensureProjectWorkspace(input.projectId);
  const directory=join(workspace.path,'nmr-simulations',result.id);
  const p=result.parameters,model={experiment:{title:'SIMULATED NMR - '+result.formula,nucleus:p.nucleus,solvent:p.solvent,obs_mhz:p.frequencyMHz,carrier_ppm:(result.spectrum.high+result.spectrum.low)/2,spectral_width_hz:(result.spectrum.high-result.spectrum.low)*p.frequencyMHz,complex_points:16384,scale:10000,noise_std:0,seed:20261102,nt:p.scans,d1_s:1},peaks:result.peaks.flatMap(peak=>peak.multiplicity==='dd'?peak.offsetsHz.map((offset,i)=>({label:peak.label+'-'+(i+1),ppm:peak.ppm+offset/p.frequencyMHz,area:peak.area/peak.offsetsHz.length,linewidth_hz:p.linewidthHz,multiplicity:'s',evidence:peak.evidence})): [{label:peak.label,ppm:peak.ppm,area:peak.area,linewidth_hz:p.linewidthHz,multiplicity:peak.multiplicity,j_hz:peak.jHz,evidence:peak.evidence}])};
  const modelPath=join(directory,'synthetic-fid-model.json');await writeFile(modelPath,JSON.stringify(model,null,2));
  const fid=await this.ctx.ibmRuntime.syntheticNmrFid(modelPath,join(directory,'synthetic-fid'));
  const prepared=await mnovaWithStartupRetry(this.ctx.ibmRuntime,input.projectId,'mnova_prepare_structure_1d',{input_path:fid.fidPath,structure_path:join(directory,'synthetic-structure.mol'),run_verification:false});
  if(!prepared?.artifacts?.mnova)throw Error('Mnova 未生成模拟谱和结构文档');
  const plan=syntheticAssignmentPlan(result,prepared),planPath=join(directory,'synthetic-assignment-plan.json');
  plan.source_analysis_path=prepared.artifacts.analysis_json;
  await writeFile(planPath,JSON.stringify(plan,null,2));
  if(plan.unmatchedEnvironments.length)throw Error('Mnova 未能唯一对应全部模拟峰与氢位点；已保留合成 FID 和准备文件供检查，未登记标峰文件');
  const output=await mnovaWithStartupRetry(this.ctx.ibmRuntime,input.projectId,'mnova_apply_assignments_1d',{prepared_mnova_path:prepared.artifacts.mnova,assignment_plan_path:planPath,run_verification:false});
  const labeled=plan.assignments;
  if(!output?.artifacts?.mnova||output.applied_assignment_count!==plan.assignments.length||!Array.isArray(output.display_labels?.spectrum)||output.display_labels.spectrum.length!==new Set(labeled.map(a=>a.multiplet_uuid)).size||output.display_labels.spectrum.some(label=>label.status==='not_drawn'))throw Error('Mnova 未完成模拟谱标峰，请检查标峰结果');
  for(const assignment of labeled){
   const atom=output.display_labels.molecule?.find(item=>item.atom_index===assignment.atom_index);
   const peak=output.display_labels.spectrum.find(item=>item.multiplet_uuid===assignment.multiplet_uuid);
   if(!atom?.label?.split(',').includes(assignment.label)||!peak?.label?.split(',').includes(assignment.label))throw Error('Mnova 结构与模拟峰标签不一致，未登记文件');
   const proton=assignment.h_index==null?null:String.fromCharCode(96+Number(assignment.h_index));
   const linked=output.assignments?.some(item=>item.atom?.index===assignment.atom_index&&(proton===null||item.atom?.h===proton)&&item.shift?.some(shift=>shift.idTypes?.some(id=>id.type==='Multiplet'&&id.uuid===assignment.multiplet_uuid)));
   if(!linked)throw Error('Mnova 未保存模拟峰与结构的交互归属，未登记文件');
  }
  if(plan.unresolved.length||plan.unmatchedEnvironments.length)result.warnings.push(`${plan.unresolved.length} 个模拟峰及 ${plan.unmatchedEnvironments.length} 个位点未能唯一匹配，未强行标注。`);
  result.assignmentSummary={assigned:labeled.length,unresolved:plan.unresolved.length,unmatched:plan.unmatchedEnvironments.length+result.unresolved.length};
  result.syntheticFidArchive=join(directory,'synthetic-fid','synthetic_1d_varian_fid.zip');
  const syntheticDocument=join(workspace.path,'nmr-simulations',result.id,'synthetic.mnova');
  await copyFile(output.artifacts.mnova,syntheticDocument);
  result.mnovaArtifact=await this.ctx.labCharacterization.registerSimulationMnova(input.projectId,input.taskId,result,syntheticDocument);
  return result;
 }
 async runSimulation(projectId,taskId,jobId,peakModel){
  if(!peakModel?.peaks?.length)throw Error('请先根据结构构建带依据的峰模型，旧自动预测器已停用');
  const task=await this.ctx.labCharacterization.updateSimulation(projectId,taskId,jobId,'running');
  try{const result=await this.simulateNmr({projectId,taskId,parameters:task.simulationJob.parameters,peakModel});await this.ctx.labCharacterization.updateSimulation(projectId,taskId,jobId,'completed',undefined,result.assignmentSummary);return result;}
  catch(error){await this.ctx.labCharacterization.updateSimulation(projectId,taskId,jobId,'failed',error.message);throw error;}
 }
}
export default IbmAnalysisService;
