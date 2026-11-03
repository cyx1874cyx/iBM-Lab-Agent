/** Tasks without an entry use a separate conversation; entry tasks resolve below. */
export async function projectSessionId(ctx,{workspaceId,reuseSessionId,fresh=false}){
 if(fresh)return ctx.sessions.create({workspaceId});
 return reuseSessionId||ctx.uiWorkspace.connectWorkspace(workspaceId);
}

export function taskEntryIdentity(options={}){
 if(options.entryIdentity)return options.entryIdentity;
 const reading=options.readingIdentity||options.translationIdentity;
 if(reading)return {kind:'reading',reportId:reading.reportId,bundleId:reading.bundleId};
 if(options.characterizationIdentity)return {kind:'nmr',taskId:options.characterizationIdentity.taskId};
 return null;
}

/** Serialize lookup, creation and binding, so rapid actions cannot fork an entry. */
export function createEntryOperationQueue(){
 const pending=new Map();
 return (projectId,entry,work)=>{
  if(!entry)return work();
  // A project queue also covers report-id and bundle-id aliases of the same paper.
  const key=projectId,previous=pending.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(work);pending.set(key,next);
  return next.finally(()=>{if(pending.get(key)===next)pending.delete(key);});
 };
}

export async function resolveEntryConversation(ctx,call,{projectId,workspaceId,entry}){
 let state;
 if(entry.kind==='reading')state=await call('tasks_reading_conversation',{request:{projectId,reportId:entry.reportId,bundleId:entry.bundleId}});
 else if(entry.kind==='plot'){
  const result=await call('plot_records_list',{request:{projectId}}),row=result.records?.find(row=>row.id===entry.recordId&&row.projectId===projectId&&row.workflow);
  if(!row)throw Error('绘图条目不存在或不属于当前课题');
  state={sessionId:row.conversationSessionId||null};
 }
 else{
  const result=await call('characterization_list',{request:{projectId}}),row=result.tasks?.find(row=>row.id===entry.taskId&&row.projectId===projectId);
  if(!row)throw Error('核磁条目不存在或不属于当前课题');
  state={sessionId:row.sessionId||row.conversationSessionId||null};
 }
 let sessionId=state.sessionId;
 if(sessionId){
  const binding=await call('projects_by_session',{request:{sessionId}});
  if(binding.bound?.project?.id!==projectId)sessionId=null;
  else try{await ctx.sessions.using(sessionId,{source:'controllerOperation'},async()=>{});}
  catch(error){if(/not.?found|不存在|已删除|deleted|unknown session/i.test(error.message||''))sessionId=null;else throw error;}
 }
 const created=!sessionId;
 if(created)sessionId=await ctx.sessions.create({workspaceId});
 return {...state,sessionId,created};
}

/** Preview a paper in its own conversation, using the same entry binding as tasks. */
export async function openReadingPreviewConversation(call,launchProject,request){
 const {project}=await call('projects_get',{request:{id:request.projectId}});
 return launchProject(project,{entryIdentity:{kind:'reading',bundleId:request.bundleId},entryOpenOnly:true,preserveDraft:true});
}

export function prefillEntryTask(input,prompt,append=false){
 const existing=append?input.state?.getSnapshot()?.draft||'':'';
 if(existing.includes(prompt))return;
 input.setDraft(existing.trim()?existing+'\n\n'+prompt:prompt);
}

/** Open an existing bound conversation without creating one or touching drafts. */
export async function openProjectConversation(ctx,call,{projectId,sessionId}){
 if(!sessionId)throw Error('此条目尚未绑定科研助手对话');
 const result=await call('projects_by_session',{request:{sessionId}});
 if(result.bound?.project?.id!==projectId)throw Error('此对话未绑定当前课题，无法从该条目打开');
 try{return await ctx.sessions.using(sessionId,{source:'controllerOperation'},async()=>{
  ctx.uiWorkspace.openSession(sessionId);return {sessionId,openedNew:false};
 });}catch{throw Error('该条目绑定的对话已不存在或暂时无法打开');}
}
