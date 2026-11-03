import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationCitation,usableShortCitation} from '../../src/literature/citation.js';

test('publication citations require a source and allow conference proceedings without a volume',()=>{
 assert.equal(publicationCitation({pages:'3723-3726',year:2020}),undefined);
 assert.equal(publicationCitation({journal:'',volume:'2020',pages:'3723-3726',year:2020}),undefined);
 assert.equal(publicationCitation({journal:'IEEE EMBC',pages:'3723-3726',year:2020}).text,'IEEE EMBC 3723–3726 (2020).');
 assert.equal(publicationCitation({journal:'Journal of Controlled Release',journalAbbrev:'J Control Release',volume:'300',pages:'10-20',year:2024}).text,'J Control Release 300, 10–20 (2024).');
 assert.equal(publicationCitation({journal:'Full Conference Name',naming:{journalAbbrev:'IEEE EMBC'},year:2020}).journal,'IEEE EMBC');
});

test('legacy page-only citations fall back to real titles instead of displaying numbers as item names',()=>{
 for(const value of ['3723-3726 (2020).','e102373 (2024).','pp. 3723–3726 (2020).','2020',''])assert.equal(usableShortCitation(value),undefined,value);
 assert.equal(usableShortCitation('Dielectric profile of blood clots to inform ischemic stroke treatments'),'Dielectric profile of blood clots to inform ischemic stroke treatments');
 assert.equal(usableShortCitation('IEEE EMBC 3723–3726 (2020).'),'IEEE EMBC 3723–3726 (2020).');
});
