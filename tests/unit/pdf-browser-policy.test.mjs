import {test} from 'node:test';import assert from 'node:assert/strict';
import {nativePdfResource,NATIVE_PDF_ORIGIN} from '../../electron-next/pdf-browser-policy.mjs';
test('native PDF resources load without granting Chrome or extension access to research pages',()=>{
 assert.equal(nativePdfResource({url:NATIVE_PDF_ORIGIN+'index.html'}),true);
 assert.equal(nativePdfResource({url:'chrome://resources/lit/v3_0/lit.rollup.js',frame:{url:NATIVE_PDF_ORIGIN+'index.html'}}),true);
 for(const url of ['chrome://settings/','chrome://resources/js/load_time_data.js','chrome-extension://other/index.html','file:///C:/private.txt'])assert.equal(nativePdfResource({url,frame:{url:'https://publisher.example/'}}),false);
 assert.equal(nativePdfResource({url:'chrome://settings/',frame:{url:NATIVE_PDF_ORIGIN+'index.html'}}),false);
});
