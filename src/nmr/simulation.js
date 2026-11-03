// Synthetic first-order line-shape model. Chemical shifts come from the predictor,
// never from solvent, sample mass or an invented sensitivity calibration.
export const SIMULATION_SOLVENTS = ['CDCl3','DMSO-d6','D2O','CD3OD','Acetone-d6','CD3CN','C6D6'];
export function simulationParameters(input={}) {
 const number=(key,fallback,min,max)=>{const n=Number(input[key]??fallback);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${key} 必须在 ${min}–${max} 之间`);return n;};
 const nucleus=input.nucleus??'1H',solvent=input.solvent??'CDCl3';
 if(!['1H','13C'].includes(nucleus))throw Error('仅支持 1H 和 13C');
 if(!SIMULATION_SOLVENTS.includes(solvent))throw Error('请选择支持的氘代溶剂');
 const scans=number('scans',16,1,100000);if(!Number.isInteger(scans))throw Error('扫描次数必须是整数');
 return {nucleus,solvent,frequencyMHz:number('frequencyMHz',nucleus==='1H'?400:100,10,1500),massMg:number('massMg',10,0.001,10000),volumeMl:number('volumeMl',0.6,0.01,1000),linewidthHz:number('linewidthHz',1.5,0.1,100),temperatureK:number('temperatureK',298,180,400),scans,includeExchangeable:input.includeExchangeable===true};
}
export function letterLabel(index){let s='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(97+(n-1)%26)+s;return s;}
export function simulateLines(peaks,parameters){
 const p=simulationParameters(parameters);
 if(!peaks.length)throw Error('没有可绘制的预测峰');
 const low=Math.min(p.nucleus==='1H'?-1:-10,...peaks.map(x=>x.ppm-1)),high=Math.max(p.nucleus==='1H'?13:230,...peaks.map(x=>x.ppm+1));
 const components=peaks.flatMap(peak=>{
  if(!Number.isFinite(peak.ppm)||!Number.isFinite(peak.area)||peak.area<=0)throw Error('无效峰模型');
  const weights=peak.weights||[1],sum=weights.reduce((a,b)=>a+b,0);
  return weights.map((weight,i)=>({label:peak.label,ppm:peak.ppm+(peak.offsetsHz?peak.offsetsHz[i]:(i-(weights.length-1)/2)*(peak.jHz||0))/p.frequencyMHz,area:peak.area*weight/sum}));
 });
 // Include each line center as well as a uniform grid so narrow peaks cannot vanish.
 const xs=[...new Set([...Array.from({length:8193},(_,i)=>high-(high-low)*i/8192),...components.map(c=>c.ppm)])].sort((a,b)=>b-a);
 const gamma=p.linewidthHz/p.frequencyMHz/2;
 const points=xs.map(ppm=>[ppm,components.reduce((sum,c)=>sum+c.area*gamma/(Math.PI*((ppm-c.ppm)**2+gamma**2)),0)]);
 return {low,high,points,components};
}
export function simulationJcamp(result){
 const {low,high}=result.spectrum,p=result.parameters,count=32768,gamma=p.linewidthHz/p.frequencyMHz/2;
 const values=Array.from({length:count},(_,i)=>{const ppm=high-(high-low)*i/(count-1);return result.spectrum.components.reduce((sum,peak)=>sum+peak.area*gamma/(Math.PI*((ppm-peak.ppm)**2+gamma**2)),0);});
 const lines=[];for(let i=0;i<count;i+=8)lines.push((high-(high-low)*i/(count-1)).toFixed(8)+' '+values.slice(i,i+8).map(v=>v.toExponential(8)).join(' '));
 return ['##TITLE=SIMULATED NMR - '+result.formula,'##JCAMP-DX=5.00','##DATA TYPE=NMR SPECTRUM','##ORIGIN=iBM Lab - SYNTHETIC DATA','##.OBSERVE FREQUENCY='+p.frequencyMHz,'##.OBSERVE NUCLEUS='+p.nucleus,'##.SOLVENT NAME='+p.solvent,'##XUNITS=PPM','##YUNITS=ARBITRARY UNITS','##XFACTOR=1','##YFACTOR=1','##FIRSTX='+high,'##LASTX='+low,'##NPOINTS='+count,'##XYDATA=(X++(Y..Y))',...lines,'##END='].join('\n')+'\n';
}
const escapeXml=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function simulationSvg(result){
 const {low,high,points}=result.spectrum,max=Math.max(...points.map(x=>x[1]));
 const x=ppm=>60+(high-ppm)/(high-low)*1000,lanes=[];
 const placed=[...result.peaks].sort((a,b)=>b.ppm-a.ppm).map(p=>{const px=x(p.ppm);let lane=lanes.findIndex(end=>end<px-38);if(lane<0)lane=lanes.length;lanes[lane]=px+38;return {p,px,lane};});
 const top=85+lanes.length*20,baseline=top+230,height=baseline+80,y=intensity=>baseline-intensity/max*220;
 const path=points.map(([ppm,intensity],i)=>`${i?'L':'M'}${x(ppm).toFixed(2)},${y(intensity).toFixed(2)}`).join(' ');
 const labels=placed.map(({p,px,lane})=>`<text x="${px.toFixed(2)}" y="${70+lane*20}" text-anchor="middle" fill="#2563eb" font-size="13">${escapeXml(p.label)} ${p.ppm.toFixed(2)}</text><path d="M${px},${76+lane*20}V${y(points.reduce((best,point)=>Math.abs(point[0]-p.ppm)<Math.abs(best[0]-p.ppm)?point:best)[1])-5}" stroke="#93b4ec" stroke-dasharray="2 3"/>`).join('');
 const step=result.parameters.nucleus==='1H'?2:20,start=Math.floor(high/step)*step;
 const ticks=Array.from({length:Math.floor((start-low)/step)+1},(_,i)=>{const ppm=start-i*step;return `<path d="M${x(ppm)},${baseline}v6" stroke="#334155"/><text x="${x(ppm)}" y="${baseline+29}" text-anchor="middle" font-size="12">${ppm}</text>`;}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 ${height}"><rect width="1120" height="${height}" fill="white"/><g font-family="Arial,Microsoft YaHei,sans-serif"><text x="60" y="28" font-size="18" fill="#172b42">iBM Lab · ${escapeXml(result.parameters.nucleus)} NMR · 模拟谱 / SYNTHETIC</text><text x="60" y="48" font-size="12" fill="#64748b">${escapeXml(result.formula)} · ${escapeXml(result.parameters.solvent)} · ${result.parameters.frequencyMHz} MHz · 一阶峰模型模拟</text><path d="${path}" fill="none" stroke="#17656b" stroke-width="1.3"/><path d="M60 ${baseline}H1060" stroke="#334155"/>${ticks}${labels}<text x="560" y="${height-20}" text-anchor="middle" font-size="14">δ / ppm</text></g></svg>`;
}
