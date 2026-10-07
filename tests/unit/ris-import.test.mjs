import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRis,parseRis,RIS_MAX_BYTES} from '../../src/literature/ris-import.js';
const ris='TY  - JOUR\r\nTI  - 核酸递送\r\nAU  - Li, A\r\nAU  - Wang, B\r\nPY  - 2025/01/01\r\nDO  - https://doi.org/10.1038/example\r\nJO  - Nature\r\nAB  - first line\r\n      continued line\r\nSP  - 1\r\nEP  - 8\r\nER  -\r\n';
test('RIS preserves Chinese metadata, authors, multiline abstracts and normalized DOI; duplicates counted',()=>{
 const parsed=parseRis('\uFEFF'+ris+ris);assert.equal(parsed.recordCount,2);assert.equal(parsed.duplicateCount,1);assert.equal(parsed.results[0].title,'核酸递送');assert.equal(parsed.results[0].abstract,'first line continued line');assert.equal(parsed.results[0].pages,'1-8');assert.equal(parsed.results[0].doi,'10.1038/example');assert.deepEqual(parsed.results[0].authors,['Li, A','Wang, B']);
});
test('UTF8 and UTF16 RIS decoding, size and malformed input validation',()=>{
 assert.equal(decodeRis(Buffer.from(ris)).encoding,'utf-8');assert.equal(parseRis(decodeRis(Buffer.concat([Buffer.from([255,254]),Buffer.from(ris,'utf16le')])).text).results[0].title,'核酸递送');
 for(const invalid of ['hello','TY  - JOUR\nTI  - A','TY  - JOUR\nER  -','TI  - A\nER  -'])assert.throws(()=>parseRis(invalid));
 assert.throws(()=>decodeRis(Buffer.alloc(RIS_MAX_BYTES+1)));assert.throws(()=>decodeRis(Buffer.alloc(0)));
});
