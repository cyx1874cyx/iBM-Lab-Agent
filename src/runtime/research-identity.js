// Existing conversations pin their preset revision. Normalize only the old
// shipped identity at prompt assembly, leaving saved configurations untouched.
export const LEGACY_RESEARCH_IDENTITY = '你是课题组本地科研 Agent（聚前药与高分子材料设计方向）';
export function generalizeResearchIdentity(assembly) {
 const sections=assembly.sections.map(section=>typeof section.text==='string'&&section.text.includes(LEGACY_RESEARCH_IDENTITY)
  ? {...section,text:section.text.replaceAll(LEGACY_RESEARCH_IDENTITY,'你是 iBM Lab 通用科研助手（适用于不同学科与研究主题，具体研究方向以用户当前问题、课题记忆与所选资料为准）')}
  : section);
 return sections.some((section,index)=>section!==assembly.sections[index])?{...assembly,sections}:assembly;
}

export function installResearchIdentity(ctx) {
 return ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>generalizeResearchIdentity(await next()),{global:true});
}
