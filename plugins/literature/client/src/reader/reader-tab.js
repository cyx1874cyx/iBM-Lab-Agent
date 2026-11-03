import {ReaderBody,readerStyles} from './reader-pdf-ui.js';
import {h} from 'dsh-lab-agent/client-sdk';
import {downloadVerifiedBinary} from 'dsh-lab-agent/client-sdk';
import workerSource from 'dsh-lab-agent/client-vendor/pdfjs/pdf.worker.mjs';
let getDocument,PDFDataRangeTransport,PDFWorker,TextLayer,GlobalWorkerOptions,pdfModule,viewerModule;
export async function loadPdf(){pdfModule??=import('dsh-lab-agent/client-vendor/pdfjs/pdf.mjs');({getDocument,PDFDataRangeTransport,PDFWorker,TextLayer,GlobalWorkerOptions}=await pdfModule);}
export async function loadPdfViewer(){await loadPdf();return viewerModule??=import('dsh-lab-agent/client-vendor/pdfjs/web/pdf_viewer.mjs');}
const PREFIX='dsh-resource://lab-reader/',ID='lab-reader',KIND='lab-reader';
let workerUrl;
// 运行时与首选模式由宿主 reader-host 持有；插件只读共享实例。
import { readerRuntime, readerPreferredMode, setReaderPreferredMode } from 'dsh-lab-agent/client-sdk';
export { readerRuntime, readerPreferredMode };
export function setReaderRuntime(){/* 宿主负责写入共享运行时 */}
export function pdfTypes(){return {getDocument,PDFWorker,TextLayer,GlobalWorkerOptions};}
export function readerWorker(){return workerUrl??=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));}
export function readerAddress({projectId,bundleId,kind='pdf'}){return PREFIX+[projectId,bundleId,kind].map(encodeURIComponent).join('/');}
export function readerIdentity(address){if(!String(address).startsWith(PREFIX))return null;const parts=String(address).slice(PREFIX.length).split('/');if(parts.length!==3)return null;try{const [projectId,bundleId,kind]=parts.map(decodeURIComponent);return projectId&&bundleId&&['pdf','si'].includes(kind)?{projectId,bundleId,kind}:null;}catch{return null;}}
export async function openReader(request){const runtime=readerRuntime();if(!runtime)throw Error('侧栏阅读器尚未就绪');const address=readerAddress(request);setReaderPreferredMode(address,request.mode);await runtime.open(address,request);window.dispatchEvent(new CustomEvent('ibm-reader-open',{detail:{address}}));}
export { translationPrompt } from '../translation-prompt.js';
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
