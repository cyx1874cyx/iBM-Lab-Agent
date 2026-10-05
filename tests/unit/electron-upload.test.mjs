import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../electron-next/file-upload.js',import.meta.url),'utf8');
test('desktop upload uses the owned document carrier and preserves body/cancellation',async()=>{
 const calls=[],controller=new AbortController(),body=new Blob(['attachment']);
 const context={location:{protocol:'dsh-app:',hostname:'app'},document:{baseURI:'dsh-app://app/'},URL,fetch:async(...args)=>{calls.push(args);return 'receipt';}};
 runInNewContext(source,context);
 assert.equal(await context.__DSH_FILE_UPLOAD__.fetch('api/session/uploadFileBinary?sessionId=fixture',{method:'POST',body,signal:controller.signal}),'receipt');
 assert.equal(calls[0][0],'dsh-app://app/api/session/uploadFileBinary?sessionId=fixture');
 assert.equal(calls[0][1].body,body);assert.equal(calls[0][1].signal,controller.signal);assert.equal(calls[0][1].credentials,'include');
 for(const path of ['https://example.org/api/session/uploadFileBinary','dsh-app://shell/api/session/uploadFileBinary','api/lab/desktop_browser'])await assert.rejects(context.__DSH_FILE_UPLOAD__.fetch(path,{}));
 assert.equal(calls.length,1);
});
test('research pages do not receive the upload transport',()=>{
 const context={location:{protocol:'https:',hostname:'publisher.example'}};
 runInNewContext(source,context);assert.equal(context.__DSH_FILE_UPLOAD__,undefined);
});
