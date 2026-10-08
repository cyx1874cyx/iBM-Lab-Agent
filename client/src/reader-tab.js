import {ReaderBody,readerStyles} from './reader-pdf-ui.js';
import {h} from './h.js';
import {downloadVerifiedBinary} from './lib.js';
import workerSource from '../vendor/pdfjs/pdf.worker.mjs';
let getDocument,PDFDataRangeTransport,PDFWorker,TextLayer,GlobalWorkerOptions,pdfModule;
export async function loadPdf(){pdfModule??=import('../vendor/pdfjs/pdf.mjs');({getDocument,PDFDataRangeTransport,PDFWorker,TextLayer,GlobalWorkerOptions}=await pdfModule);}
const PREFIX='dsh-resource://lab-reader/',ID='lab-reader',KIND='lab-reader';
let runtime=null,workerUrl;const preferredModes=new Map();
export function setReaderRuntime(value){runtime=value;}
export function readerRuntime(){return runtime;}
export function pdfTypes(){return {getDocument,PDFWorker,TextLayer,GlobalWorkerOptions};}
export function readerPreferredMode(key){return preferredModes.get(key)??'original';}
export function readerWorker(){return workerUrl??=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));}
export function readerAddress({projectId,bundleId,kind='pdf'}){return PREFIX+[projectId,bundleId,kind].map(encodeURIComponent).join('/');}
export function readerIdentity(address){if(!String(address).startsWith(PREFIX))return null;const parts=String(address).slice(PREFIX.length).split('/');if(parts.length!==3)return null;try{const [projectId,bundleId,kind]=parts.map(decodeURIComponent);return projectId&&bundleId&&['pdf','si'].includes(kind)?{projectId,bundleId,kind}:null;}catch{return null;}}
export async function openReader(request){if(!runtime)throw Error('侧栏阅读器尚未就绪');const address=readerAddress(request);preferredModes.set(address,request.mode??'original');await runtime.open(address,request);window.dispatchEvent(new CustomEvent('ibm-reader-open',{detail:{address}}));}
export function translationPrompt(request,translationId){return `请全文翻译当前课题已归档${request.kind==='si'?'SI':'正文'} PDF（bundleId: ${request.bundleId}，translationId: ${translationId}，kind: ${request.kind??'pdf'}）。先调用 lab_reader_translation_prepare，再循环调用 lab_reader_translation_read（pendingOnly=true, offset=0, limit=8），逐块完整翻译并用 lab_reader_translation_write 保存，直到没有未翻译块。不得以精读报告或摘要代替全文；保留数字、公式、化学式、图注及参考文献。每个文本块结合 context 前后文理解。遇到 continuation，先整体理解其 original，再把连续译文准确分配到全部 fragments 的原位置，不重复也不遗漏；同批提交全部片段并附 reviewedGroups=[continuation.id]，必要时单独读取或写入该组。figure-text 是图片中的英文标签，须结合 imagePath 检查 OCR、翻译标签，保留数字、单位和化学式；低置信度或模糊内容用 note 标注，不得猜测。扫描块必须读取 imagePath 图像转写英文并翻译。最后核对完整性、术语和不确定性，调用 lab_reader_translation_finish。失败时说明原因，已归档原文保持可读。`;}
const decode=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export function pdfResources(call){
 class CMaps{async fetch({name}){return {cMapData:decode((await call('tasks_reader_asset',{group:'cmaps',name:name+'.bcmap'})).base64),compressionType:1};}}
 class Fonts{async fetch({filename}){return decode((await call('tasks_reader_asset',{group:'standard_fonts',name:filename})).base64);}}
 return {useSystemFonts:true,useWasm:false,cMapPacked:true,cMapUrl:'virtual/',CMapReaderFactory:CMaps,standardFontDataUrl:'virtual/',StandardFontDataFactory:Fonts,isEvalSupported:false};
}
export function makeRange(request,opened,call){return new (class extends PDFDataRangeTransport{
 constructor(request,opened,call){super(opened.bytes,new Uint8Array(),false,opened.fileName);this.request={...request,lease:opened.lease};this.call=call;this.stopped=false;}
 requestDataRange(begin,end){void(async()=>{const chunks=[];for(let offset=begin;offset<end&&!this.stopped;offset+=262144)chunks.push(decode((await this.call('tasks_reader_chunk',{request:{...this.request,offset,length:Math.min(262144,end-offset)}})).base64));if(this.stopped)return;const all=new Uint8Array(chunks.reduce((sum,x)=>sum+x.length,0));let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}this.onDataRange(begin,all);})().catch(error=>this.onError?.(error));}
 abort(){this.stopped=true;}
})(request,opened,call);}
export function registerReaderTab(ctx){
 ctx.effect(()=>{const style=document.createElement('style');style.textContent=readerStyles;document.head.append(style);return()=>style.remove();},'iBM PDF 文字选择与双语布局');
 ctx.effect(()=>ctx.sidebarRightTabs.register({id:ID,kind:KIND,patterns:[PREFIX+'**'],priority:'extension',title:()=> '文献阅读'}),'iBM 文献阅读 tab');
 ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:ID},ReaderBody)),'iBM 文献阅读内容');
 ctx.effect(()=>()=>setReaderRuntime(null),'iBM 文献阅读清理');
}
