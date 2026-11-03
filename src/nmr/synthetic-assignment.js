// This links the simulator's own predicted environments to peaks in the same
// synthetic spectrum. It is not an assignment of experimental observations.
export function syntheticAssignmentPlan(result,analysis){
 if(analysis.status!=='ok'||analysis.operation!=='prepare_structure_1d')throw Error('Mnova 未返回有效的模拟谱准备结果');
 const atoms=new Map((analysis.atoms||[]).map(a=>[a.index,a])),multiplets=analysis.multiplets||[],assignments=[],unresolved=[],unmatchedEnvironments=[],used=new Set();
 const tolerance=Math.max(0.01,result.parameters.linewidthHz/result.parameters.frequencyMHz*3);
 for(const peak of result.peaks){
  const matches=multiplets.filter(m=>Number.isFinite(m.ppm)&&Math.abs(m.ppm-peak.ppm)<=tolerance);
  if(matches.length!==1){unmatchedEnvironments.push({label:peak.label,ppm:peak.ppm,reason:'无法唯一匹配 Mnova 多重峰'});continue;}
  const m=matches[0];
  for(const id of peak.attachedAtomIds){
   const atom=atoms.get(id),sites=atom?.non_equivalent_h_indices||[];
   if(!atom||result.parameters.nucleus==='1H'&&!sites.length){unmatchedEnvironments.push({label:peak.label,ppm:peak.ppm,reason:'无法确定 Mnova 氢位点'});continue;}
   const sameAtom=result.peaks.filter(other=>other.attachedAtomIds.includes(id));
   if(result.parameters.nucleus==='1H'&&sameAtom.length>1){unmatchedEnvironments.push({label:peak.label,ppm:peak.ppm,reason:'同一原子上的模拟氢不能唯一对应 Mnova 氢位点'});continue;}
   if(result.parameters.nucleus==='1H'&&sites.length!==1){unmatchedEnvironments.push({label:peak.label,ppm:peak.ppm,reason:'无法可靠对应 Mnova 氢位点'});continue;}
   const h=result.parameters.nucleus==='1H'?sites[0]:null,key=id+':'+h;if(used.has(key)){unmatchedEnvironments.push({label:peak.label,ppm:peak.ppm,reason:'同一位点对应多个预测环境'});continue;}used.add(key);
   assignments.push({label:peak.label,atom_index:id,h_index:h,multiplet_uuid:m.uuid,ppm:m.ppm,range_min_ppm:Math.min(m.range_min_ppm,m.range_max_ppm),range_max_ppm:Math.max(m.range_min_ppm,m.range_max_ppm),confidence:'medium',evidence:'模拟模型生成的原子环境和峰位置对应；不是实测归属'});
  }
 }
 for(const m of multiplets)if(!assignments.some(a=>a.multiplet_uuid===m.uuid))unresolved.push({multiplet_uuid:m.uuid,ppm:m.ppm,range_min_ppm:m.range_min_ppm,range_max_ppm:m.range_max_ppm,classification:'unknown',integration_policy:'review',reason:'模拟峰未能对应结构位点'});
 if(!assignments.length)throw Error('Mnova 模拟谱没有可匹配的结构峰，不能生成标峰文件');
 return {source_job_id:analysis.job_id,synthetic:true,assignments,unresolved,unmatchedEnvironments};
}
