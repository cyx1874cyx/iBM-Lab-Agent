/** Structural evidence complements the user's visual comparison; never pixel parity. */
export function checkOriginConsistency(spec,result){
 const checks=[],add=(property,expected,actual)=>checks.push({property,expected,actual:actual??null,status:actual===undefined?'unverified':JSON.stringify(expected)===JSON.stringify(actual)?'matched':'different'});
 const graph=result.readback?.graph,multi=spec.layout.mode==='panels';
 add('图层数',multi?spec.yCols.length:1,graph?.layers_count);
 for(const [index,layer] of (graph?.layers||[]).entries()){
  add(`图层 ${index+1} 系列数`,multi?1:spec.yCols.length,layer.plots_count);
  if(!multi){for(const [field,expected] of [['width',spec.widthCm],['height',spec.heightCm]]){const actual=result.readback?.layers?.[index]?.properties?.['layer.'+field];add('图层 '+field+' (cm)',expected,actual===undefined?undefined:Math.abs(actual-expected)<=.005?expected:actual);}}
  for(const [pi,plot] of (layer.plots||[]).entries()){
   const column=multi?spec.yCols[index]:spec.yCols[pi],style=spec.series.find(s=>s.column===column)||{};
   if(style.color){const rgb=[1,3,5].map(i=>parseInt(style.color.slice(i,i+2),16));add('系列 '+column+' 颜色',rgb,plot.color);}
   if(style.symbolKind!==undefined)add('系列 '+column+' 符号',style.symbolKind,plot.symbol_kind);
   if(style.symbolSize!==undefined)add('系列 '+column+' 符号大小',style.symbolSize,plot.symbol_size);
   if(style.lineWidth!==undefined)add('系列 '+column+' 线宽',style.lineWidth,plot.line_width??undefined);
  }
  for(const axis of ['x','y']){
   for(const [field,prop,sign] of [['tickOffsetX','offseth',1],['tickOffsetY','offsetv',-1]])if(spec[axis+'Axis'][field]!==undefined){const expected=sign*spec[axis+'Axis'][field],actual=result.readback?.layers?.[index]?.properties?.['layer.'+axis+'.label.'+prop];add(axis+' 数字刻度 '+field,expected,actual===undefined?undefined:Math.abs(actual-expected)<1e-6?expected:actual);}
   const settings=spec[axis+'Axis'];
   if(settings.ticks!==undefined){const expected={none:0,in:5,out:10,both:15}[settings.ticks],actual=result.readback?.layers?.[index]?.properties?.['layer.'+axis+'.ticks'];add(axis+' 刻度方向',expected,actual);}
   if(settings.step!==undefined){const actual=layer.axes?.[axis]?.limits?.[2];add(axis+' 主刻度间隔',settings.step,actual===undefined?undefined:Math.abs(actual-settings.step)<1e-8?settings.step:actual);}
   add(`图层 ${index+1} ${axis} 标题`,spec[axis+'Label'],layer.axes?.[axis]?.title?.replace(/\\[bi]\((.*?)\)/g,'$1'));
   for(const [field,i] of [['min',0],['max',1]])if(settings[field]!==undefined){const actual=layer.axes?.[axis]?.limits?.[i];add(`${axis} ${field}`,settings[field],actual===undefined?undefined:Math.abs(actual-settings[field])<1e-8?settings[field]:actual);}
  }
 }
 if(result.readback?.passed!==undefined)add('文字位置读回',true,result.readback.passed);
 return {status:checks.some(c=>c.status==='different')?'differences':checks.some(c=>c.status==='unverified')?'unverified':'matched',checks,visualReviewRequired:true};
}
