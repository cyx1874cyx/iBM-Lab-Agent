/** Regenerate one malformed provider response. No guessing or executing broken JSON. */
export function installModelRecovery(ctx) {
 const attempts=new WeakMap();
 return ctx.on('agent/request-error',async(payload,next)=>{
  const {agent,turn,step,provider,failure,signal}=payload;
  if(!agent||signal?.aborted||!String(provider).startsWith('deepseek')||failure?.code!=='MALFORMED_RESPONSE'||!String(failure.message).includes('tool input is invalid JSON'))return next();
  const key=turn+':'+step;
  if(attempts.get(agent)===key)return next();
  attempts.set(agent,key);
  ctx.logger.warn('科研任务：模型返回的工具参数格式无效，重新请求一次；已完成的工具操作不会重放。');
  return {kind:'retry'};
 },{global:true,prepend:true});
}
