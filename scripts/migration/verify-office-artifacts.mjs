/** Isolated software acceptance; never a human scientific review. */
/* global document */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function verifyOfficeArtifacts({ page, auth, rpc, runDir, python }) {
 const output=join(runDir,'office');mkdirSync(output);
 const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
 const results=[];
 for(const [kind,extension,pages] of [['report','docx',1],['ppt','pptx',2]]){
  const ref=`/api/lab-artifacts?kind=${kind}&format=${extension}&reportId=p5-report-1`;
  const get=async suffix=>{
   const response=await fetch(auth.origin+ref+suffix,{headers:{cookie:auth.cookie,origin:auth.origin},signal:AbortSignal.timeout(120000)});
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200,bytes.toString());
   assert.equal(Number(response.headers.get('content-length')),bytes.length);
   assert.equal(response.headers.get('x-content-sha256'),digest(bytes));return {response,bytes};
  };
  const source=await get('');assert.match(source.response.headers.get('content-disposition'),/^attachment;/);
  const preview=await get('&preview=1');assert.equal(preview.response.headers.get('content-type'),'application/pdf');
  assert.equal(preview.response.headers.get('x-source-sha256'),digest(source.bytes));
  const previewFile=join(output,`${kind}.pdf`);writeFileSync(previewFile,preview.bytes);
  writeFileSync(join(output,`source.${extension}`),source.bytes);
  const inspection=JSON.parse(execFileSync(python,['-c',
   'import pymupdf,json,sys; d=pymupdf.open(sys.argv[1]); print(json.dumps({"pages":len(d),"text":"".join(p.get_text() for p in d)})); d[0].get_pixmap().save(sys.argv[2])',previewFile,join(output,`${kind}.png`)],{encoding:'utf8',windowsHide:true}));
  assert.equal(inspection.pages,pages);assert.match(inspection.text,/P5 ISOLATED SOFTWARE FIXTURE/);
  const cached=await get('&preview=1');assert.deepEqual(cached.bytes,preview.bytes);
  const downloadDir=join(output,`${kind}-ui-download`);mkdirSync(downloadDir);
  const session=await page.createCDPSession();
  try{
   await session.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
   await page.evaluate(type=>{
    const row=[...document.querySelectorAll('.ib-lit-item')].find(node=>node.innerText.includes('P5 待审核精读'));
    assertButton(row?.querySelector(`[data-kind="${type}"]`));
    function assertButton(button){if(!button||button.disabled)throw Error('Office button missing/disabled');button.click();}
   },kind==='report'?'reading':'ppt');
   let files=[];
   for(let attempt=0;attempt<200;attempt++){
    files=readdirSync(downloadDir).filter(name=>name.endsWith('.'+extension));if(files.length)break;
    await new Promise(done=>setTimeout(done,100));
   }
   assert.equal(files.length,1,'formal UI failed to download '+extension);
   assert.deepEqual(readFileSync(join(downloadDir,files[0])),source.bytes);
   await page.screenshot({path:join(output,`${kind}-ui.png`),fullPage:true});
  }finally{await session.detach();}
  const workspace=await rpc('lab','projects_workspace',{request:{projectId:'p5-composition'}});
  const row=kind==='report'?workspace.literature.reports.find(row=>row.id==='p5-report-1'):workspace.literature.presentations.find(row=>row.id==='p5-ppt-1');
  assert.equal(row.status,'under-review');assert.notEqual(row.review?.status,'approved','Opening must not silently approve');
  // Exercise the existing review API only in this synthetic project, explicitly
  // identify test automation as reviewer; do not assert human layout approval.
  const method=kind==='report'?'tasks_report_review':'tasks_presentation_review';
  const fields={...(kind==='report'?{reportId:'p5-report-1'}:{runId:'p5-ppt-1'}),decision:'approved',note:'P5 synthetic software acceptance only; not a scientific review',reviewer:'p5-isolated-software-verifier'};
  const reviewed=await rpc('lab',method,{request:{fields}});
  const approved=reviewed.report??reviewed.run;
  assert.equal(approved.review.artifactSha256,digest(source.bytes));assert.equal(approved.review.reviewer,'p5-isolated-software-verifier');
  const after=await get('');assert.deepEqual(after.bytes,source.bytes);
  results.push({kind,pages,sourceSha256:digest(source.bytes),previewSha256:digest(preview.bytes),sourceBytes:source.bytes.length,previewBytes:preview.bytes.length,uiDownload:true,optionalReviewHashBound:true});
 }
 return {ok:true,results,nativeSaveDialog:'user_deferred',systemOfficeWindow:'not_visually_verified',preview:'actual LibreOffice conversion over authenticated NEXT HTTP; fixtures only'};
}
