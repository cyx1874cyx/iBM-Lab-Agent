import {z} from 'zod';
import {plotSpecSchema} from './workspace.js';
const item=z.object({object:z.enum(['legend','title','xTitle','yTitle']),dx:z.number().min(-.15).max(.15).default(0),dy:z.number().min(-.15).max(.15).default(0)}).strict();
export const refinementSchema=z.object({reason:z.string().max(600),adjustments:z.array(item).max(4)}).strict();
/** Accept one complete JSON object in explanatory text, without relaxing the plan schema. */
export function parseRefinementResponse(text){
 const input=String(text??'').trim();if(!input)throw Error('模型没有返回可解析的文本');
 const candidates=[];let start=-1,depth=0,quoted=false,escaped=false;
 for(let i=0;i<input.length;i++){
  const char=input[i];
  if(start<0){if(char==='{'){start=i;depth=1;quoted=false;escaped=false;}continue;}
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&!--depth){
   try{const value=JSON.parse(input.slice(start,i+1)),result=refinementSchema.safeParse(value);if(result.success)candidates.push(result.data);}catch{/* Try the next complete object. */}
   start=-1;
  }
 }
 if(candidates.length!==1)throw Error(candidates.length?'模型返回多个精修方案，无法确定采用哪一个':'模型未返回符合要求的精修 JSON');
 return candidates[0];
}
export function applyOriginRefinement(base,proposal){
 const result=plotSpecSchema.parse(base),plan=refinementSchema.parse(proposal),seen=new Set();
 for(const row of plan.adjustments){if(seen.has(row.object))throw Error('精修对象重复');seen.add(row.object);
  if(row.object==='legend'){if(!result.showLegend)throw Error('图例未显示');result.legendX=Math.max(0,Math.min(1,result.legendX+row.dx));result.legendY=Math.max(0,Math.min(1,result.legendY+row.dy));}
  else if(row.object==='title'){if(!result.titleText)throw Error('图标题为空');result.titleStyle={...result.titleStyle,x:Math.max(-1,Math.min(2,(result.titleStyle.x??.5)+row.dx)),y:Math.max(-1,Math.min(2,(result.titleStyle.y??-.15)+row.dy))};}
  else{const key=row.object==='xTitle'?'xTitleStyle':'yTitleStyle',style={...result[key]};for(const [axis,delta] of [['x',row.dx],['y',row.dy]])if(delta){if(style[axis]===undefined)throw Error('轴标题未设置可验证的 '+axis+' 位置');style[axis]=Math.max(-1,Math.min(2,style[axis]+delta));}result[key]=style;}
 }
 return {spec:plotSpecSchema.parse(result),plan};
}
export function describeRefinementAdjustments(adjustments){
 const names={legend:'图例',title:'图标题',xTitle:'X 轴标题',yTitle:'Y 轴标题'};
 return adjustments.map(row=>{const parts=[];if(row.dx)parts.push((row.dx>0?'向右':'向左')+Math.abs(row.dx).toFixed(3));if(row.dy)parts.push((row.dy>0?'向下':'向上')+Math.abs(row.dy).toFixed(3));return names[row.object]+'请求位置'+(parts.join('、')||'不变');}).join('；');
}
export function positionDeviation(readback,target){
 const desired={'legend.x':target.legendX,'legend.y':target.legendY,...(target.titleText?{'ibmTitle.x':target.titleStyle.x??.5,'ibmTitle.y':target.titleStyle.y??-.15}:{}),...Object.fromEntries([['xb',target.xTitleStyle],['yl',target.yTitleStyle]].flatMap(([obj,style])=>['x','y'].filter(axis=>Number.isFinite(style?.[axis])).map(axis=>[obj+'.'+axis,style[axis]])))},rows=[];
 for(const layer of readback?.layers||[])for(const p of layer.positions||[]){if(layer.layer!==0||!(p.property in desired)||!Number.isFinite(p.target)||!Number.isFinite(p.signedError)||(p.errorFraction!==undefined&&(!Number.isFinite(p.errorFraction)||p.errorFraction>=1e6)))continue;rows.push({property:p.property,expected:desired[p.property],actual:p.target+p.signedError,error:p.target+p.signedError-desired[p.property]});}
 return {rows,score:rows.reduce((n,p)=>n+Math.abs(p.error),0)};
}
