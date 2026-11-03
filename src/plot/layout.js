import {z} from 'zod';
const finite=z.number().finite(),mm=finite.min(0).max(2000),dimension=finite.min(.1).max(2000);
const file=z.object({path:z.string(),fileName:z.string(),byteLength:z.number(),sha256:z.string()});
const base={id:z.string().min(1).max(100),x:mm,y:mm,w:dimension,h:dimension,locked:z.boolean().default(false),pinned:z.boolean().default(false),groupId:z.string().optional(),opacity:finite.min(0).max(1).default(1)};
const color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const crop=z.object({x:finite.min(0).max(1),y:finite.min(0).max(1),w:finite.positive().max(1),h:finite.positive().max(1)}).refine(c=>c.x+c.w<=1+1e-9&&c.y+c.h<=1+1e-9,'裁剪区域超出图片');
export const layoutObjectSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('panel'),assetId:z.string(),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0),flipH:z.boolean().default(false),flipV:z.boolean().default(false),aspectLocked:z.boolean().default(true),crop:crop.default({x:0,y:0,w:1,h:1})}),
 z.object({...base,type:z.enum(['text','arrow','rect','scale']),direction:z.enum(['se','sw','ne','nw','right','left','up','down']).default('se'),text:z.string().max(500).default(''),color:color.default('#000000'),fontSize:finite.min(4).max(100).default(10),lineWidth:finite.min(.1).max(10).default(.5)}),
]);
export const layoutDocSchema=z.object({
 page:z.object({w:finite.min(10).max(600).default(180),h:finite.min(10).max(600).default(120),margin:mm.default(5),background:color.default('#FFFFFF'),transparent:z.boolean().default(false),grid:finite.min(.5).max(50).default(1),showGrid:z.boolean().default(true),snap:z.boolean().default(true),guidesX:z.array(mm).max(30).default([]),guidesY:z.array(mm).max(30).default([])}).default({w:180,h:120,margin:5,background:"#FFFFFF",transparent:false,grid:1,showGrid:true,snap:true,guidesX:[],guidesY:[]}),
 labels:z.object({enabled:z.boolean().default(true),position:z.enum(['outside','inside']).default('outside'),size:finite.min(4).max(72).default(10),color:color.default('#000000'),dx:finite.min(0).max(20).default(0),dy:finite.min(0).max(20).default(1)}).default({enabled:true,position:'outside',size:10,color:"#000000",dx:0,dy:1}),
 objects:z.array(layoutObjectSchema).max(200).default([]),
 groups:z.array(z.object({id:z.string(),mode:z.enum(['row','col','grid','free']),order:z.array(z.string()).max(200),gap:finite.min(0).max(50).default(3),columns:z.number().int().min(1).max(12).default(2),align:z.enum(['start','center','end']).default('start'),uniform:z.enum(['none','width','height']).default('none')})).max(50).default([]),
}).refine(d=>new Set(d.objects.map(o=>o.id)).size===d.objects.length,'版面对象编号重复');
export const layoutAssetSchema=z.object({id:z.string(),sourceId:z.string(),title:z.string(),width:z.number().positive(),height:z.number().positive(),image:file,preview:file,vector:file.optional()});
const artifacts=z.object({preview:file,png:file,pdf:file,tiff:file});
export const layoutRecordSchema=z.object({version:z.literal(1),revision:z.number().int().positive(),doc:layoutDocSchema,assets:z.array(layoutAssetSchema).max(100),saved:artifacts,savedAt:z.string(),dpi:z.union([z.literal(150),z.literal(300),z.literal(600)]).default(300),history:z.array(z.object({doc:layoutDocSchema,saved:artifacts,savedAt:z.string(),dpi:z.number()})).max(20).default([])});
export const layoutSource=row=>row.image?{kind:row.image.format,preview:'preview'}:row.layout?{kind:'组合版面',preview:'preview'}:row.workflow?.saved?.preview?{kind:'Origin',preview:'preview'}:row.workflow?.draft?.preview?{kind:'Origin 初稿',preview:'draft-preview'}:null;
export const panelLabel=index=>{let text='';do{text=String.fromCharCode(97+index%26)+text;index=Math.floor(index/26)-1;}while(index>=0);return '('+text+')';};
export function labelPosition(doc,object,index){const labels=doc.labels,size=labels.size*25.4/72,width=panelLabel(index).length*size*.6;let y=labels.position==='inside'?object.y+labels.dy+size:object.y-labels.dy;if(y<size*1.1)y=object.y+labels.dy+size;return {x:Math.max(0,Math.min(object.x+labels.dx,doc.page.w-width)),y:Math.max(size*1.1,Math.min(y,doc.page.h-size*.2))};}
export function arrowPoints(o){const [ax,ay,bx,by]=({se:[0,0,1,1],sw:[1,0,0,1],ne:[0,1,1,0],nw:[1,1,0,0],right:[0,.5,1,.5],left:[1,.5,0,.5],up:[.5,1,.5,0],down:[.5,0,.5,1]})[o.direction||'se'];const a={x:o.x+ax*o.w,y:o.y+ay*o.h},b={x:o.x+bx*o.w,y:o.y+by*o.h},angle=Math.atan2(b.y-a.y,b.x-a.x),head=(5+o.lineWidth*2)*25.4/72;return {a,b,head:`${b.x},${b.y} ${b.x-head*Math.cos(angle-.45)},${b.y-head*Math.sin(angle-.45)} ${b.x-head*Math.cos(angle+.45)},${b.y-head*Math.sin(angle+.45)}`};}
export const outsidePage=doc=>doc.objects.filter(o=>o.x+o.w>doc.page.w+.001||o.y+o.h>doc.page.h+.001);
export function resizeObject(object,values){const next={...object,...values};if(object.type==='panel'&&object.aspectLocked){if(values.w!==undefined&&values.h===undefined)next.h=object.h*next.w/object.w;if(values.h!==undefined&&values.w===undefined)next.w=object.w*next.h/object.h;}return next;}
function layoutUnits(doc,ids){
 const chosen=doc.objects.filter(o=>ids.includes(o.id)&&!o.locked&&!o.pinned),grouped=new Map(),units=[];
 for(const object of chosen){if(object.groupId){if(!grouped.has(object.groupId))grouped.set(object.groupId,[]);grouped.get(object.groupId).push(object);}else units.push({...object,members:[object]});}
 for(const [id,members] of grouped){const x=Math.min(...members.map(o=>o.x)),y=Math.min(...members.map(o=>o.y));units.push({id:'group:'+id,type:'panel',aspectLocked:true,x,y,w:Math.max(...members.map(o=>o.x+o.w))-x,h:Math.max(...members.map(o=>o.y+o.h))-y,members});}
 return units.sort((a,b)=>doc.objects.findIndex(o=>o.id===a.members[0].id)-doc.objects.findIndex(o=>o.id===b.members[0].id));
}
function applyUnits(doc,units,patches){const changes=new Map();for(const unit of units){const next=patches.get(unit.id);if(!next)continue;for(const o of unit.members){const sx=next.w/unit.w,sy=next.h/unit.h;changes.set(o.id,{...o,x:next.x+(o.x-unit.x)*sx,y:next.y+(o.y-unit.y)*sy,w:o.w*sx,h:o.h*sy});}}return {...doc,objects:doc.objects.map(o=>changes.get(o.id)||o)};}
export function gridObjects(doc,ids,columns=2,gap=6){
 const chosen=layoutUnits(doc,ids);if(!chosen.length)return doc;
 const cols=Math.min(Math.max(1,columns),chosen.length),rows=Math.ceil(chosen.length/cols),m=doc.page.margin;
 const cw=(doc.page.w-2*m-(cols-1)*gap)/cols,ch=(doc.page.h-2*m-(rows-1)*gap)/rows;if(Math.min(cw,ch)<=0)return doc;
 const boxes=new Map(chosen.map((o,i)=>{const k=Math.min(cw/o.w,ch/o.h);return [o.id,{x:m+(i%cols)*(cw+gap),y:m+Math.floor(i/cols)*(ch+gap),w:o.w*k,h:o.h*k}];}));
 return applyUnits(doc,chosen,boxes);
}
export function expandSelection(doc,ids){const groups=new Set(doc.objects.filter(o=>ids.includes(o.id)).map(o=>o.groupId).filter(Boolean));return doc.objects.filter(o=>ids.includes(o.id)||groups.has(o.groupId)).map(o=>o.id);}
export function arrangeObjects(doc,ids,mode,reference='selection',primary=ids[0],gap=3){
 const objects=layoutUnits(doc,ids);if(!objects.length)return doc;
 const xs=objects.map(o=>o.x),ys=objects.map(o=>o.y),bounds={x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...objects.map(o=>o.x+o.w)),bottom:Math.max(...objects.map(o=>o.y+o.h))};
 const anchor=reference==='page'?{x:0,y:0,w:doc.page.w,h:doc.page.h}:reference==='primary'?objects.find(o=>o.members.some(m=>m.id===primary))||doc.objects.find(o=>o.id===primary):{x:bounds.x,y:bounds.y,w:bounds.right-bounds.x,h:bounds.bottom-bounds.y};if(!anchor)return doc;
 const patches=new Map();
 if(['hdist','vdist','hgap','vgap'].includes(mode)){
  const horizontal=mode.startsWith('h'),axis=horizontal?'x':'y',size=horizontal?'w':'h',sorted=[...objects].sort((a,b)=>a[axis]-b[axis]);if(sorted.length<(mode.endsWith('dist')?3:2))return doc;
  const space=mode.endsWith('dist')?(sorted.at(-1)[axis]+sorted.at(-1)[size]-sorted[0][axis]-sorted.reduce((s,o)=>s+o[size],0))/(sorted.length-1):gap;let value=sorted[0][axis];
  for(const o of sorted){patches.set(o.id,{...o,[axis]:Math.max(0,value)});value+=o[size]+space;}
 }else for(const o of objects){let p={...o};if(mode==='left')p.x=anchor.x;if(mode==='hcenter')p.x=anchor.x+(anchor.w-o.w)/2;if(mode==='right')p.x=anchor.x+anchor.w-o.w;if(mode==='top')p.y=anchor.y;if(mode==='vcenter')p.y=anchor.y+(anchor.h-o.h)/2;if(mode==='bottom')p.y=anchor.y+anchor.h-o.h;if(mode==='samew')p=resizeObject(o,{w:reference==='primary'?anchor.w:Math.max(...objects.map(o=>o.w))});if(mode==='sameh')p=resizeObject(o,{h:reference==='primary'?anchor.h:Math.max(...objects.map(o=>o.h))});p.x=Math.max(0,p.x);p.y=Math.max(0,p.y);patches.set(o.id,p);}
 return applyUnits(doc,objects,patches);
}
export function reflowGroups(doc){
 let objects=doc.objects.map(o=>({...o}));
 for(const group of doc.groups){if(group.mode==='free')continue;const members=group.order.map(id=>objects.find(o=>o.id===id)).filter(o=>o&&!o.locked&&!o.pinned);if(members.length<2)continue;
  const x=Math.min(...members.map(o=>o.x)),y=Math.min(...members.map(o=>o.y));let sized=members;
  if(group.uniform!=='none'){const key=group.uniform==='width'?'w':'h',target=Math.max(...members.map(o=>o[key]));sized=members.map(o=>resizeObject(o,{[key]:target}));}
  const cols=group.mode==='row'?sized.length:group.mode==='col'?1:group.columns,colW=Array(cols).fill(0),rowH=[];
  sized.forEach((o,i)=>{colW[i%cols]=Math.max(colW[i%cols],o.w);rowH[Math.floor(i/cols)]=Math.max(rowH[Math.floor(i/cols)]||0,o.h);});
  sized.forEach((o,i)=>{const c=i%cols,r=Math.floor(i/cols),ox=x+colW.slice(0,c).reduce((s,n)=>s+n+group.gap,0),oy=y+rowH.slice(0,r).reduce((s,n)=>s+n+group.gap,0),factor=group.align==='center'?.5:group.align==='end'?1:0;const next={...o,x:ox+(colW[c]-o.w)*factor,y:oy+(rowH[r]-o.h)*factor};objects=objects.map(v=>v.id===o.id?next:v);});
 }
 return {...doc,objects};
}
export function snapMove(doc,object,x,y,excluded=[]){
 if(!doc.page.snap)return {x,y};const other=doc.objects.filter(o=>o.id!==object.id&&!excluded.includes(o.id)),m=doc.page.margin;
 const targetsX=[0,m,doc.page.w/2,doc.page.w-m,doc.page.w,...doc.page.guidesX,...other.flatMap(o=>[o.x,o.x+o.w/2,o.x+o.w])],targetsY=[0,m,doc.page.h/2,doc.page.h-m,doc.page.h,...doc.page.guidesY,...other.flatMap(o=>[o.y,o.y+o.h/2,o.y+o.h])];
 const snap=(value,size,targets)=>{let best=null;for(const offset of [0,size/2,size])for(const target of targets){const delta=target-value-offset;if(Math.abs(delta)<=1.2&&(best===null||Math.abs(delta)<Math.abs(best)))best=delta;}return best===null?Math.round(value/doc.page.grid)*doc.page.grid:value+best;};return {x:snap(x,object.w,targetsX),y:snap(y,object.h,targetsY)};
}
