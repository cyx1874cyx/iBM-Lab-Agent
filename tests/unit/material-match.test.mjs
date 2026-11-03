import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundedSiMetadata, matchingBody, matchingCandidates, matchingExcerpt, verifiedContentParent } from '../../src/literature/material-match.js';

const a = 'Bland Altman analysis found a mean bias of 1.1% between histopathology and impedance measurements.';
const b = 'The limits of agreement ranged from -42.4% to 44.5% (Supplementary Figure S2).';
const sa = 'Supplementary Figure 2. Bland Altman plot with a bias of 1.1% between the two measurements.';
const sb = 'The 95% confidence interval limits of agreement ranged from -42.4 to 44.5%.';
const source = sa+'\n'+sb;
const paper = {id:'parent',text:a+'\n'+b};
const match = {bundleId:paper.id,evidence:[{siQuote:sa,paperQuote:a},{siQuote:sb,paperQuote:b}]};

test('supplement ownership requires independent quotations with matching specific results from one unique paper', () => {
 assert.equal(verifiedContentParent(match,source,[paper,{id:'other',text:'Unrelated work on the same impedance and thrombus topic.'}]),'parent');
 assert.equal(verifiedContentParent(match,source,[paper,{id:'ambiguous',text:paper.text}]),undefined);
 assert.equal(verifiedContentParent({...match,bundleId:'other'},source,[paper]),undefined);
 assert.equal(verifiedContentParent({...match,evidence:[match.evidence[0],match.evidence[0]]},source,[paper]),undefined);
 assert.equal(verifiedContentParent({...match,evidence:[match.evidence[0],{siQuote:sb,paperQuote:'Invented result: limits ranged from -42.4 to 44.5%.'}]},source,[paper]),undefined);
 assert.equal(verifiedContentParent(match,'Supplementary methods without the quoted results',[paper]),undefined);
 assert.equal(verifiedContentParent(match,source,[{...paper,text:'Unrelated study\nReferences\n'+paper.text}]),undefined);
});

test('candidate excerpts retain supporting results beyond a long introduction and exclude bibliography evidence', () => {
 const long = ('General introduction about the research. ').repeat(1400)+'\n'+a+'\n'+b+'\nReferences\nUnrelated reference 999.123';
 const excerpt = matchingExcerpt(long,source,12000);
 assert.ok(excerpt.includes(a));assert.ok(excerpt.includes(b));assert.ok(excerpt.length<=12000);
 assert.ok(!matchingBody(long).includes('999.123'));
 const selected = matchingCandidates(source,[{id:'right',text:long},...Array.from({length:20},(_,n)=>({id:'other-'+n,text:'Unrelated polymer impedance study without these statistics.'}))]);
 assert.equal(selected.length,8);assert.equal(selected[0].id,'right');
});

test('copying candidate title and DOI cannot bypass validation of SI content evidence', () => {
 const copied={documentKind:'si',title:'Known parent paper title',titleZh:'候选论文标题',doi:'10.5555/parent',journal:'Candidate Journal',year:2024,authors:['Candidate Author'],parentMatch:match};
 const result=groundedSiMetadata(copied,source);
 assert.equal(result.doi,undefined);assert.equal(result.title,'');assert.equal(result.titleZh,'');assert.equal(result.journal,undefined);assert.deepEqual(result.authors,[]);
 assert.equal(result.parentMatch,match);
 const explicit=groundedSiMetadata(copied,'Supporting Information for Known parent paper title. DOI: 10.5555/parent');
 assert.equal(explicit.title,copied.title);assert.equal(explicit.doi,copied.doi);
});

test('two-column PDF extraction may interleave adjacent sentences but evidence cannot span distant passages', () => {
 const interleaved=a.replace('of 1.1%','of [text from the adjacent column] 1.1%')+'\n'+b.replace('ranged from','[text from the adjacent column] ranged from');
 assert.equal(verifiedContentParent(match,source,[{...paper,text:interleaved}]),paper.id);
 const distant=a.replace('of 1.1%','of '+('unrelated paragraph ').repeat(100)+' 1.1%')+'\n'+b;
 assert.equal(verifiedContentParent(match,source,[{...paper,text:distant}]),undefined);
});
