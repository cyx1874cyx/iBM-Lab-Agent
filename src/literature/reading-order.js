export function orderedReadingReports(reports, order = []) {
 const positions = new Map(order.map((id,index)=>[id,index]));
 return [...reports].sort((a,b)=>{
  const ai=positions.get(a.id),bi=positions.get(b.id);
  if(ai!==undefined&&bi!==undefined)return ai-bi;
  if(ai!==undefined)return 1;
  if(bi!==undefined)return -1;
  return b.createdAt.localeCompare(a.createdAt);
 });
}

export function moveReadingIds(order, ids, targetId, position='before') {
 const selected=new Set(ids);
 if(selected.has(targetId))return [...order];
 const moving=order.filter(id=>selected.has(id)),rest=order.filter(id=>!selected.has(id));
 const index=rest.indexOf(targetId);
 if(index<0)throw Error('排序目标不存在');
 rest.splice(index+(position==='after'?1:0),0,...moving);
 return rest;
}
