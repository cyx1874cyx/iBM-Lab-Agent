import assert from 'node:assert/strict';
import {Service} from '@deepseek-ai/cordis';

/** Conversion boundary fixture for workflow tests; rendering has separate acceptance. */
export default class OfficePdfFixture extends Service {
 constructor(ctx){super(ctx,'officeToPdf');}
 async convert(request,signal){
  signal.throwIfAborted();
  assert.ok(['docx','pptx'].includes(request.extension));
  const source=await request.source.read(signal,50*1024*1024);
  assert.equal(source.version,request.source.version);
  assert.equal(source.bytes.length,request.source.bytes);
  assert.equal(Buffer.from(source.bytes).subarray(0,2).toString(),'PK');
  return {pdf:Buffer.from('%PDF-1.4\n% workflow fixture '+source.version+'\n%%EOF\n')};
 }
}
