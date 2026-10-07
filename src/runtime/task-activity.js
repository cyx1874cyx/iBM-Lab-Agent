/** Real execution and registered workflow states. Never infer a completion percentage. */
export const TASK_LABELS=Object.freeze({wechat:'微信文献元数据',capture:'文献正文 / SI 获取',reading:'文献精读',translation:'文献全文翻译',ppt:'文献 PPT 制作',synthesis:'合成路线登记',nmr:'核磁标峰',origin:'Origin 绘图'});
export const runningPetTasks=tasks=>tasks.filter(row=>row.status==='running');
export function selectPetTask(tasks){return runningPetTasks(tasks)[0];}
export function toolActivity(name,args={}) {
 const text=(String(name)+(name==='skill'?' '+String(args.name??''):'' )).toLowerCase();let kind,stage;
 if(/translation/.test(text)){kind='translation';stage=/prepare/.test(text)?'正在解析 PDF 页面':/finish/.test(text)?'正在校验与归档译文':'正在翻译全文';}
 else if(/wechat/.test(text)){kind='wechat';stage=/fetch/.test(text)?'正在获取微信页面':/doi/.test(text)?'正在核对文献元数据':'正在登记文献元数据';}
 else if(/mnova|nmr/.test(text)){kind='nmr';stage=/prepare|preflight/.test(text)?'正在读取谱图与结构':/assign|written/.test(text)?'正在标峰与写入谱图':/verify/.test(text)?'正在核验标峰':'正在处理核磁谱图';}
 else if(/origin|plot/.test(text)){kind='origin';stage=/export|save/.test(text)?'正在导出与归档图件':'正在处理数据与绘图';}
 else if(/characterization/.test(text)){kind=args.kind==='plot'?'origin':'nmr';stage='正在更新科研分析任务';}
 else if(/synth/.test(text)){kind='synthesis';stage=/evidence/.test(text)?'正在登记路线证据':'正在登记合成路线';}
 else if(/ppt|presentation/.test(text)){kind='ppt';stage=/build/.test(text)?'正在制作幻灯片':/register|complete/.test(text)?'正在登记 PPT 成品':'正在处理 PPT 任务';}
 else if(/reading|reader|report/.test(text)&&!/review/.test(text)){kind='reading';stage=/input/.test(text)?'正在读取文献与精读要求':/register|complete/.test(text)?'正在登记精读报告':'正在处理精读报告';}
 else if(/browser|capture|publisher.*download|nature.*download/.test(text)){kind='capture';stage=/observe|debug/.test(text)?'正在观察文献页面':/click/.test(text)?'正在选择下载入口':/wait/.test(text)?'正在等待页面或下载变化':'正在获取文献正文 / SI';}
 if(!kind||/list$|status$|get$|cancel$|templates|contract/.test(text))return null;
 return {kind,label:TASK_LABELS[kind],stage};
}
export class TaskActivity {
 constructor(now=()=>Date.now(),changed=()=>{}){this.now=now;this.changed=changed;this.rows=new Map();this.turns=new Map();}
 update(id,patch){const row={...this.rows.get(id),...patch,id,updatedAt:this.now()};this.rows.set(id,row);if(this.rows.size>100){const oldest=[...this.rows.values()].filter(row=>!['running','waiting','queued'].includes(row.status)).sort((a,b)=>a.updatedAt-b.updatedAt)[0];if(oldest)this.rows.delete(oldest.id);}this.changed();return row;}
 start(exec){const sessionId=exec.agent?.session?.header?.id;const prior=sessionId&&this.turns.get(sessionId);const activity=toolActivity(exec.name,exec.arguments)??(prior?.kind?{kind:prior.kind,label:prior.label,stage:/read/.test(exec.name)?'正在读取任务文件':/bash|shell|python/.test(exec.name)?'正在执行科研处理脚本':'正在执行当前任务步骤'}:null);if(!activity)return null;
  if(sessionId&&this.turns.has(sessionId)){this.turns.set(sessionId,{...prior,...activity,projectId:exec.projectId??exec.arguments?.projectId??prior.projectId});this.update('turn:'+sessionId,{...activity,projectId:exec.projectId??exec.arguments?.projectId??prior.projectId,sessionId,status:'running',percent:null,startedAt:prior.startedAt});}
  return this.update('tool:'+exec.callId,{...activity,sessionId,status:'running',startedAt:this.now(),projectId:exec.projectId??exec.arguments?.projectId,percent:null});}
 event(session,event){const id=session.header.id;if(event.type==='turn/start')this.turns.set(id,{startedAt:this.now()});if(event.type==='step/start'){const prior=this.turns.get(id);if(prior?.kind)this.update('turn:'+id,{...prior,sessionId:id,status:'running',stage:'正在分析当前任务与下一步',percent:null});}if(event.type==='turn/end'){this.turns.delete(id);for(const row of this.rows.values())if(row.sessionId===id&&row.status==='running')this.update(row.id,{status:event.data.reason.kind==='completed'?'completed':event.data.reason.kind==='error'?'failed':'cancelled',stage:'当前任务已结束'});}}
 finish(id,result,aborted=false){if(!id)return;const failed=result?.isError===true||result?.value?.ok===false||result?.status==='error';return this.update(id,{status:aborted?'cancelled':failed?'failed':'completed',stage:aborted?'当前操作已取消':failed?'当前操作失败':'当前步骤完成',percent:null});}
 snapshot(extra=[]){const combined=new Map([...this.rows.values()].map(row=>[row.id,row]));for(const row of extra)combined.set(row.id,row);const rank={running:3,waiting:2,queued:1};return [...combined.values()].filter(row=>{if(row.id.startsWith('turn:')&&[...combined.values()].some(other=>other.id.startsWith('tool:')&&other.sessionId===row.sessionId&&other.status==='running'))return false;if(/^(turn|tool):/.test(row.id)&&[...combined.values()].some(other=>!/^(turn|tool):/.test(other.id)&&other.status==='running'&&other.projectId&&other.projectId===row.projectId&&other.kind===row.kind))return false;return ['running','waiting','queued'].includes(row.status)||this.now()-(Number(row.updatedAt)||0)<120000;}).sort((a,b)=>(rank[b.status]??0)-(rank[a.status]??0)||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0)).slice(0,8);}
}
const statuses={pending:['queued','等待开始'],queued:['queued','等待执行'],running:['running','正在执行'],armed:['waiting','等待下载入口或机构登录'],'under-review':['waiting','等待检查或人工确认'],prepared:['waiting','等待标峰确认'],'approved-written':['waiting','标峰已写入，等待目视核验'],'visually-verified':['completed','核验完成'],succeeded:['completed','任务完成'],completed:['completed','任务完成'],failed:['failed','任务失败'],cancelled:['cancelled','任务已取消']};
export function registeredActivity(row,kind,now=Date.now()){
 const [status,stage]=row.status==='expired'?['failed','任务已过期，请重新发起']:row.status==='uploading'?['running','正在归档']:statuses[row.status]??['waiting','等待处理'];
 return {id:kind+':'+row.id,kind,label:TASK_LABELS[kind],projectId:row.projectId,status,stage,percent:null,startedAt:Date.parse(row.createdAt)||now,updatedAt:Date.parse(row.updatedAt??row.completedAt??row.createdAt)||now};
}
export function activitySnapshot(core,ctx) {
 const extra=[];
 for(const [table,kind] of [['reports','reading'],['presentations','ppt']])for(const id of core.table(table).keys())extra.push(registeredActivity(core.table(table).get(id),kind));
 const capture=ctx.get('labCapture'),desktop=ctx.get('ibmScientificDesktop');
 if(capture?.table)for(const id of capture.table.keys()){
  const task=capture.table.get(id),row=registeredActivity(task,'capture'),live=desktop?.armed?.get(id);
  if(task.status==='completed'){row.stage='归档完成';row.percent=100;}
  if(live){row.status='running';row.stage=live.processing?'正在归档':live.downloading?'正在下载':live.loading?'正在加载页面':live.observing?'正在查找下载入口':'等待下载入口或机构登录';if(!live.processing&&!live.downloading&&!live.loading&&!live.observing)row.status='waiting';row.updatedAt=Date.now();row.percent=!live.processing&&live.downloading&&live.totalBytes>0?Math.min(99,live.bytes/live.totalBytes*100):null;if(live.bytes>0)row.detail=`已下载 ${(live.bytes/1048576).toFixed(2)} MB${live.totalBytes>0?' / '+(live.totalBytes/1048576).toFixed(2)+' MB':''}`;}
  if(live?.accessChecking&&!live.downloading&&!live.processing){row.status='running';row.stage='正在检查文献访问权限';}
  if(live?.access&&['login-required','verification-required'].includes(live.access.state)&&!live.downloading&&!live.processing){row.status='waiting';row.stage=live.access.state==='login-required'?'等待机构登录':'等待人机验证';}
  extra.push(row);
 }
 const characterization=ctx.get('labCharacterization');
 if(characterization?.table)for(const id of characterization.table.keys()){const task=characterization.table.get(id);extra.push(registeredActivity(task,task.kind==='plot'?'origin':'nmr'));}
 return {connected:true,tasks:core.activity.snapshot(extra)};
}
