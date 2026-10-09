import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// PDF.js 5.4.624 uses one static PagesMapper for every document. Its viewer
// resets that singleton on detach, invalidating PDFs retained by other panes.
// Follow the per-document mapper ownership already used by DSH's PDF renderer.
// Transform at build time; upstream vendor files and their hashes stay intact.
export function isolatePdfDocumentState(source,viewer=false){
 if(viewer){
  assert.ok(source.includes('this.#pagesMapper.pagesNumber = 0;'));
  return source.replace('this.#pagesMapper.pagesNumber = 0;','this.#pagesMapper = new PagesMapper();')
   .replace('const pagesCount = pdfDocument.numPages;','this.#pagesMapper = pdfDocument.pagesMapper;\n    const pagesCount = pdfDocument.numPages;');
 }
 const start=source.indexOf('class PagesMapper {'),end=source.indexOf('\n}\n',start)+2;
 assert.ok(start>0&&end>start);
 const mapper=source.slice(start,end).replaceAll('static #','#').replaceAll('PagesMapper.#','this.#');
 source=source.slice(0,start)+mapper+source.slice(end);
 assert.equal(source.split('#pagesMapper = PagesMapper.instance;').length,3);
 return source.replaceAll('#pagesMapper = PagesMapper.instance;','#pagesMapper = new PagesMapper();')
  .replace('this._pageIndex = pageIndex;','this.#pagesMapper = transport.pagesMapper;\n    this._pageIndex = pageIndex;')
  .replace('class WorkerTransport {','class WorkerTransport {\n  get pagesMapper() { return this.#pagesMapper; }')
  .replace('class PDFDocumentProxy {','class PDFDocumentProxy {\n  get pagesMapper() { return this._transport.pagesMapper; }');
}
export function pdfDocumentStatePlugin(){return {name:'pdf-document-state',setup(build){
 build.onLoad({filter:/pdfjs[\\/](?:web[\\/]pdf_viewer|pdf)\.mjs$/},async({path})=>({contents:isolatePdfDocumentState(await readFile(path,'utf8'),path.endsWith('pdf_viewer.mjs')),loader:'js'}));
}};}
