import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {h,useProjectViewValue} from 'dsh-lab-agent/client-sdk';

const kinds={chemical:'化学试剂',biological:'生物试剂',cells:'细胞'};
const sourceTime=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'';

export function ReagentPanel({call}){
 const [query,setQuery]=useProjectViewValue('_lab','reagents-query','');
 const [kind,setKind]=useProjectViewValue('_lab','reagents-kind','all');
 const [location,setLocation]=useState(''),[status,setStatus]=useState('all'),[offset,setOffset]=useState(0);
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[selected,setSelected]=useState(null);
 const force=useRef(false);
 useEffect(()=>{
  let active=true,sequence=0;
  const load=async()=>{
   const id=++sequence;setLoading(true);
   const refresh=force.current;force.current=false;
   try{const result=await call('reagents_search',{request:{query,kind,location,status,offset,limit:50,refresh}});if(active&&id===sequence){setData(result);setError('');}}
   catch(reason){if(active&&id===sequence)setError(reason.message);}
   finally{if(active&&id===sequence)setLoading(false);}
  };
  const initial=setTimeout(load,180),timer=setInterval(load,20000);
  return()=>{active=false;clearTimeout(initial);clearInterval(timer);};
 },[call,query,kind,location,status,offset,revision]);
 useEffect(()=>{
  if(!selected)return;
  const escape=event=>{if(event.key==='Escape')setSelected(null);};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
 },[selected]);
 const refresh=()=>{force.current=true;setRevision(old=>old+1);};
 const sourceAction=async(method,id)=>{
  setBusy(true);setError('');
  try{const result=await call(method,{request:{id}});if(method==='reagents_choose_source'&&!result.cancelled){setOffset(0);refresh();}}
  catch(reason){setError(reason.message);}finally{setBusy(false);}
 };
 const sources=data?.sources||Object.entries(kinds).map(([id,label])=>({id,label,configured:false,count:0}));
 const warnings=sources.filter(source=>source.error);
 return h('section',{className:'ib-reagents','aria-label':'试剂管理'},
  h('div',{className:'ib-reagent-search'},
   h('label',{className:'ib-reagent-search-label',htmlFor:'ib-reagent-query'},'检索清单'),
   h('div',{className:'ib-reagent-search-line'},h('input',{id:'ib-reagent-query',type:'search',value:query,placeholder:'名称、CAS、货号、品牌或存放位置',onChange:event=>{setQuery(event.target.value);setOffset(0);}}),h('button',{className:'ib-act',disabled:busy||loading,onClick:refresh},'刷新清单'))),
  h('div',{className:'ib-reagent-filters'},
   h('div',{className:'ib-reagent-kinds',role:'group','aria-label':'清单类型'},[['all','全部'],...Object.entries(kinds)].map(([id,label])=>h('button',{key:id,className:'ib-act','aria-pressed':kind===id,onClick:()=>{setKind(id);setLocation('');setOffset(0);}},label,h('span',null,String(data?.counts?.[id]??0))))),
   h('label',null,h('span',null,'存放位置'),h('select',{'aria-label':'存放位置',value:location,onChange:event=>{setLocation(event.target.value);setOffset(0);}},h('option',{value:''},'全部位置'),(data?.locations||[]).map(value=>h('option',{value,key:value},value)))),
   h('label',null,h('span',null,'清单标记'),h('select',{'aria-label':'清单标记',value:status,onChange:event=>{setStatus(event.target.value);setOffset(0);}},h('option',{value:'all'},'全部标记'),h('option',{value:'unmarked'},'未标记用完'),h('option',{value:'used'},'已标记用完')))),
  error?h('div',{className:'ib-error',role:'alert'},error):null,
  warnings.map(source=>h('div',{className:'ib-reagent-source-warning',role:'status',key:source.id},`${source.label}：${source.error}${source.stale?'，当前显示上次读取的数据。':'。'}`)),
  h('details',{className:'ib-reagent-sources'},h('summary',null,'数据来源',h('span',null,`${sources.filter(s=>s.configured).length} 份清单 · 保存 Excel 后自动同步`)),
   sources.map(source=>h('div',{className:'ib-reagent-source',key:source.id},h('div',null,h('b',null,source.label),h('span',{title:source.path},source.fileName||'尚未关联清单'),h('small',null,source.configured?`${source.count} 条${source.modifiedAt?' · 文件更新 '+sourceTime(source.modifiedAt):''}`:'选择本机 Excel 文件'),(source.warnings||[]).map(text=>h('small',{key:text},text))),h('div',null,h('button',{className:'ib-act',disabled:busy||!source.configured,onClick:()=>void sourceAction('reagents_open_source',source.id)},'打开清单'),h('button',{className:'ib-act',disabled:busy,onClick:()=>void sourceAction('reagents_choose_source',source.id)},source.configured?'更换清单':'关联清单'))))),
  h('div',{className:'ib-reagent-results-head',role:'status'},h('b',null,loading?'正在检索…':`找到 ${data?.total||0} 条`),h('span',null,'数量与用完标记按原表显示')),
  h('div',{className:'ib-reagent-results','aria-busy':loading},(data?.records||[]).map(row=>h('article',{className:'ib-reagent-row',key:row.id,'data-reagent-id':row.id},
   h('div',{className:'ib-reagent-main'},h('button',{className:'ib-reagent-name',onClick:()=>setSelected(row)},row.name),h('div',{className:'ib-reagent-identifiers'},row.cas?h('span',null,(row.casAsDate?'CAS 原表为日期：':'CAS ')+row.cas):null,row.catalogNumber?h('span',null,'货号 '+row.catalogNumber):null),h('small',null,`${kinds[row.kind]} · ${row.sheet} · 第 ${row.row} 行`)),
   h('div',{className:'ib-reagent-spec'},h('span',null,row.spec||'规格未填写'),h('small',null,row.brand||'品牌未填写')),
   h('div',{className:'ib-reagent-place'},h('small',null,'存放位置'),h('span',null,row.location)),
   h('div',{className:'ib-reagent-stock'},h('span',null,row.quantity?`${row.quantity}${row.unit&&!row.quantity.includes(row.unit)?' '+row.unit:''}`:'数量未填写'),row.used?h('small',{'data-used':true},'已标记用完'):null),
   h('button',{className:'ib-act',onClick:()=>setSelected(row),'aria-label':`查看 ${row.name} 详情`},'详情')))),
  !loading&&!data?.records?.length?h('div',{className:'ib-lit-empty'},sources.every(s=>!s.configured)?'请先展开“数据来源”，关联试剂清单。':'没有匹配的条目，试试其他名称、CAS 或货号。'):null,
  data?.total>data?.limit?h('div',{className:'ib-reagent-pagination'},h('span',null,`${data.offset+1}–${Math.min(data.offset+data.limit,data.total)} / ${data.total}`),h('button',{className:'ib-act',disabled:loading||data.offset===0,onClick:()=>setOffset(Math.max(0,data.offset-data.limit))},'上一页'),h('button',{className:'ib-act',disabled:loading||data.offset+data.limit>=data.total,onClick:()=>setOffset(data.offset+data.limit)},'下一页')):null,
  selected?createPortal(h('div',{className:'ib-overlay ib-reagent-modal',onClick:event=>{if(event.target===event.currentTarget)setSelected(null);}},h('section',{className:'ib-reagent-detail',role:'dialog','aria-modal':true,'aria-label':'试剂条目详情'},h('header',null,h('h2',null,selected.name),h('button',{className:'ib-act',autoFocus:true,onClick:()=>setSelected(null)},'关闭')),h('p',null,`${selected.fileName} / ${selected.sheet} / 第 ${selected.row} 行`),h('dl',null,h('div',null,h('dt',null,'存放位置'),h('dd',null,selected.location)),selected.fields.map((field,index)=>h('div',{key:index},h('dt',null,field.label),h('dd',null,field.value,field.note?h('small',null,field.note):null)))),h('footer',null,h('button',{className:'ib-act',disabled:busy,onClick:()=>void sourceAction('reagents_open_source',selected.sourceId)},'打开原始清单')))),document.body):null);
}
