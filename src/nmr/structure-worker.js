import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import initIndigo from 'indigo-ketcher/binaryWasmNoRender';
import OCL from 'openchemlib-extended';
import {parseStringPromise,Builder} from 'xml2js';
import {molecularWeightFromFormula} from '../chemistry/elements.js';
import {simulationParameters,simulateLines,letterLabel,simulationSvg} from './simulation.js';

export async function inspectStructure({source,format='smiles',parameters,peakModel}){
 const p=simulationParameters(parameters),require=createRequire(import.meta.url);
 const indigo=await initIndigo({wasmBinary:await readFile(join(dirname(require.resolve('indigo-ketcher')),'indigo-ketcher-norender-1.46.0.wasm'))});
 const options=new indigo.MapStringString();
 let molfile;
 try{
  // Embind accepts byte arrays for std::string, preserving binary CDX bytes.
  let input=format==='cdx'?Uint8Array.from(Buffer.from(source,'base64')):source;
  if(format==='mrv'){
   const xml=await parseStringPromise(source),molecules=[];
   const visit=node=>{if(!node||typeof node!=='object')return;for(const [key,value] of Object.entries(node)){if(key==='molecule')molecules.push(...value.filter(m=>m.atomArray));else if(key!=='$')for(const child of Array.isArray(value)?value:[value])visit(child);}};
   visit(xml);if(molecules.length!==1)throw Error('MRV 必须包含一个完整分子');
   input=new Builder({headless:true}).buildObject({cml:{molecule:molecules[0]}});
  }
  if(format==='sdf'&&source.split('$$$$').filter(s=>s.trim()).length!==1)throw Error('一次请选择一个分子，SDF 中含多个记录');
  molfile=indigo.layout(indigo.convert(input,'molfile',options),'molfile',options);
 }catch(error){throw Error('结构读取失败：请检查文件是否包含单个完整分子，或另存为 MOL / SMILES。'+String(error).slice(0,200));}
 finally{options.delete();}
 const molecule=OCL.Molecule.fromMolfile(molfile);
 if(!molecule.getAllAtoms()||molecule.getAllAtoms()>250)throw Error('模拟支持 1–250 个显式原子的单个分子');
 const smiles=molecule.toSmiles();
 if(smiles.includes('.')||smiles.includes('*'))throw Error('请提供单个、连接完整且不含 R 基的具体分子');
 const formula=molecule.getMF().mf,molecularWeight=molecularWeightFromFormula(formula);
 molecule.addImplicitHydrogens();
 const heavyIndices=new Map();let heavyCount=0;
 for(let i=0;i<molecule.getAllAtoms();i++)if(molecule.getAtomicNo(i)!==1)heavyIndices.set(i,++heavyCount);
 const groups=molecule.getGroupedDiastereotopicAtomIDs().filter(g=>g.atomLabel===(p.nucleus==='1H'?'H':'C')).sort((a,b)=>a.atoms[0]-b.atoms[0]);
 const environments=[];
 molecule.ensureHelperArrays(OCL.Molecule.cHelperNeighbours);
 for(const group of groups){
  const atom=group.atoms[0],parent=p.nucleus==='1H'?molecule.getConnAtom(atom,0):atom;
  const exchangeable=p.nucleus==='1H'&&[7,8,16].includes(molecule.getAtomicNo(parent));
  environments.push({id:letterLabel(environments.length),atomIds:group.atoms.map(i=>i+1),attachedAtomIds:[...new Set(group.atoms.map(i=>heavyIndices.get(p.nucleus==='1H'?molecule.getConnAtom(i,0):i)))].filter(Number.isInteger),area:group.atoms.length,exchangeable});
 }
 const drawing=molecule.getCompactCopy();drawing.removeExplicitHydrogens();
 for(let i=0;i<drawing.getAllAtoms();i++)drawing.setAtomMapNo(i,i+1,false);
 let structureSvg=drawing.toSVG(600,240,'synthetic-structure',{showMapping:true,inflateToMaxAVBL:true});
 const xs=[...structureSvg.matchAll(/\b(?:x|x1|x2|cx)="(-?[\d.]+)"/g)].map(m=>Number(m[1])),ys=[...structureSvg.matchAll(/\b(?:y|y1|y2|cy)="(-?[\d.]+)"/g)].map(m=>Number(m[1]));
 if(xs.length&&ys.length){const left=Math.min(...xs)-22,top=Math.min(...ys)-22,width=Math.max(110,Math.max(...xs)-left+22),height=Math.max(90,Math.max(...ys)-top+22);structureSvg=structureSvg.replace(/viewBox="[^"]+"/,`viewBox="${left} ${top} ${width} ${height}"`);}
 const base={synthetic:true,version:2,engine:'科研助手构建峰模型 / nmr-analyze-simulate',formula,smiles,molfile:drawing.toMolfile(),structureSvg,molecularWeight,concentrationMm:p.massMg/molecularWeight/p.volumeMl*1000,parameters:p,environments};
 if(!peakModel)return base;
 if(typeof peakModel.provenance!=='string'||!peakModel.provenance.trim())throw Error('峰模型必须注明来源与不确定性');
 if(!Array.isArray(peakModel.peaks)||!peakModel.peaks.length||peakModel.peaks.length>250)throw Error('需提供含有 1–250 个峰的峰模型');
 const seen=new Set(),peaks=[];
 const weights={s:[1],d:[1,1],t:[1,2,1],q:[1,3,3,1],dd:[1,1,1,1],quintet:[1,4,6,4,1],sextet:[1,5,10,10,5,1],septet:[1,6,15,20,15,6,1]};
 for(const entry of peakModel.peaks){
  const group=environments.find(g=>g.id===entry.environmentId);
  if(!group||seen.has(group.id))throw Error('峰模型环境编号无效或重复：'+entry.environmentId);seen.add(group.id);
  if(group.exchangeable&&(!p.includeExchangeable||['D2O','CD3OD'].includes(p.solvent)))throw Error('当前设置不包含交换氢：'+group.id);
  const ppm=entry.ppm,jHz=entry.jHz,multiplicity=entry.multiplicity;
  if(!Number.isFinite(ppm)||ppm< -20||ppm>300||!weights[multiplicity]||!Number.isFinite(jHz)||jHz<0||jHz>100||weights[multiplicity].length>1&&jHz<=0||multiplicity==='s'&&jHz!==0)throw Error('峰位、多重性或 J 值无效：'+group.id);
  const extraJHz=entry.extraJHz??0;if(!Number.isFinite(extraJHz)||extraJHz<0||extraJHz>100||multiplicity==='dd'&&extraJHz<=0||multiplicity!=='dd'&&extraJHz!==0)throw Error('第二个 J 值仅适用于 dd 且须大于零：'+group.id);
  if(typeof entry.evidence!=='string'||!entry.evidence.trim())throw Error('峰模型缺少依据：'+group.id);
  const offsetsHz=multiplicity==='dd'?[-1,1].flatMap(a=>[-1,1].map(b=>(a*jHz+b*extraJHz)/2)):undefined;
  peaks.push({...group,label:group.id,ppm,area:group.area,multiplicity,jHz,extraJHz,offsetsHz,weights:weights[multiplicity],evidence:entry.evidence.trim().slice(0,1000)});
 }
 const unresolved=environments.filter(g=>!seen.has(g.id)).map(g=>({...g,label:g.id,reason:g.exchangeable?'交换氢未建模':'科研助手未提供有依据的峰模型'}));
 const warnings=['模拟谱，不能替代实测数据或用于证明结构与纯度。','峰位、多重性及耦合常数为科研助手构建的模型；依据不充分的环境未建模。','溶剂、温度和扫描次数仅记录条件；未建立溶剂/温度位移校正与绝对信噪比模型。','样品质量与体积仅用于计算名义浓度；13C 峰面积为碳数示意，非定量积分。'];
 if(unresolved.length)warnings.push(`${unresolved.length} 个原子环境未建模。`);
 const result={...base,peaks,unresolved,warnings,modelProvenance:String(peakModel.provenance||'科研助手推测').slice(0,2000)};
 result.spectrum=simulateLines(peaks,p);result.svg=simulationSvg(result);return result;
}
if(parentPort){try{parentPort.postMessage({result:await inspectStructure(workerData)});}catch(error){parentPort.postMessage({error:error.message||String(error)});}}
