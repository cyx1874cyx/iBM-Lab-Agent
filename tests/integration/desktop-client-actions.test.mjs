/** Real Gateway/Service/core with a transport fixture; this does not certify native dialog rendering. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { bootLite } from "../helpers/boot-lite.mjs";
import { installDesktopClient, nativeArtifact, nativeBrowser, setDesktopProject } from "../../client/src/desktop-client.js";
import { buildDocx } from "../fixtures/office-builder.mjs";
import { buildPptx } from "../fixtures/pptx-builder.mjs";
import { resolveDesktopArtifact } from "../../src/runtime/desktop-artifacts.js";

test('browser actions keep separate leases for two conversations in the same project and never focus the older conversation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ibm-browser-session-'));let handle,uninstall,current='old-session';
 const windows=new Map(),calls=[];
 try{
  handle=await bootLite({storageRoot:join(dir,'storage'),coreOnly:true,includePython:false,extraRows:[
   {id:'runtime',name:'dsh-lab-agent/runtime'},{id:'desktop',name:'dsh-lab-agent/scientific-desktop'},
   {id:'typert',name:'@deepseek-ai/dsh-typert-registry'},{id:'gateway',name:'@deepseek-ai/dsh-api-gateway'},{id:'remote',name:'dsh-lab-agent/remote'}
  ]});
  const {ctx}=handle;await ctx.ibmCore.createProject({id:'same-project',name:'同课题两个对话'});
  ctx.ibmScientificDesktop.broker={dispose:async()=>{},call:async(method,input)=>{
   calls.push({method,input});
   if(method==='open'){const lease=randomUUID();windows.set(lease,input);return {lease};}
   if(method==='state'){if(!windows.has(input.lease))throw Error('scientific browser lease is closed');return {lease:input.lease};}
   if(method==='focus')return {shown:true};
   if(method==='close'){windows.delete(input.lease);return {closed:true};}
   throw Error('Unexpected operation: '+method);
  }};
  uninstall=installDesktopClient((method,args)=>ctx.typertGateway.invoke({namespace:'lab',method,args:args?.request?{request:args.request}:{}}),()=>current);
  setDesktopProject('same-project');
  const old=await nativeBrowser('open');current='new-session';const fresh=await nativeBrowser('open');
  assert.notEqual(fresh.lease,old.lease);assert.equal(windows.get(fresh.lease).sessionId,'new-session');
  calls.length=0;assert.equal((await nativeBrowser('open')).lease,fresh.lease);
  assert.ok(calls.some(row=>row.method==='focus'&&row.input.lease===fresh.lease));
  assert.equal(calls.some(row=>row.method==='focus'&&row.input.lease===old.lease),false);
  await nativeBrowser('close');assert.equal((await nativeBrowser('status')).window,null);
  current='old-session';assert.equal((await nativeBrowser('status')).window.lease,old.lease);
 }finally{uninstall?.();await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});

test("client native actions resolve registered bytes, deny raw paths and teardown staged copies; closed windows stay closed", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-native-ui-")); let handle, uninstall;
 const windows = new Map(), staged = new Map(), calls = [];
 try {
  handle = await bootLite({ storageRoot: join(dir, "storage"), coreOnly: true, includePython: false, extraRows: [
   { id: "runtime", name: "dsh-lab-agent/runtime" }, { id: "desktop", name: "dsh-lab-agent/scientific-desktop" },
   { id: "typert", name: "@deepseek-ai/dsh-typert-registry" }, { id: "gateway", name: "@deepseek-ai/dsh-api-gateway" }, { id: "remote", name: "dsh-lab-agent/remote" }
  ] });
  const { ctx } = handle;
  ctx.ibmScientificDesktop.broker = { dispose: async () => {}, call: async (method, input) => {
   calls.push({ method, input });
   if (method === "open") { const lease = randomUUID(); windows.set(lease, input); return { lease, title: "Fixture" }; }
   if (method === "state") { if (!windows.has(input.lease)) throw new Error("scientific browser lease is closed"); return { lease: input.lease, title: "Fixture" }; }
   if (method === "focus") return { shown: true };
   if (method === "close") { windows.delete(input.lease); return { closed: true }; }
   if (method === "stage") { const fileId = randomUUID(); staged.set(fileId, Buffer.from(input.base64, "base64")); return { fileId }; }
   if (method === "preview") { assert.ok(staged.has(input.fileId)); return { previewOpened: true }; }
   if (method === "save") return { cancelled: true };
   if (method === "discard") { staged.delete(input.fileId); return { discarded: true }; }
   throw new Error("Fixture deliberately rejects other native operations");
  } };
  const call = (method, args) => ctx.typertGateway.invoke({ namespace: "lab", method, args: args?.request ? { request: args.request } : {} });
  uninstall = installDesktopClient(call);
  await ctx.ibmCore.createProject({ id: "fixture", name: "界面契约" }); setDesktopProject("fixture");
  const pdf = Buffer.from("%PDF-1.4\n/Type /Page\n" + " ".repeat(12000) + "\n%%EOF"), path = join(dir, "fixture.pdf"); await writeFile(path, pdf);
  await ctx.ibmCore.commitSourceBundle({ id: "fixture-source", projectId: "fixture", title: "Synthetic transport fixture", status: "succeeded", pdfPath: path, pdfSha256: createHash("sha256").update(pdf).digest("hex"), createdAt: "2026-10-04", updatedAt: "2026-10-04" });
  const url = "/api/lab-artifacts?kind=pdf&bundleId=fixture-source";
  assert.equal((await nativeArtifact("preview", { url })).previewOpened, true); assert.equal(staged.size, 0);
  assert.deepEqual(Buffer.from(calls.find(row => row.method === "stage").input.base64, "base64"), pdf);
  assert.equal((await nativeArtifact("save", { url })).cancelled, true); assert.equal(staged.size, 0);
  for (const url of ["file:///C:/Windows/win.ini", "https://example.com/x.pdf", "/api/lab-artifacts?kind=pdf&bundleId=../fixture"])
   await assert.rejects(nativeArtifact("preview", { url }));
  await assert.rejects(nativeArtifact("storeCredential", { value: "fixture" }), /Unsupported artifact action/);
  for (const fileName of ["../x.ris", "x:stream.ris", "x.exe", "x\u0000.ris"])
   await assert.rejects(nativeArtifact("saveRis", { fileName, text: "TY  - JOUR\nER  -" }), /Invalid RIS export/);
  await nativeBrowser("open"); await nativeBrowser("open"); assert.equal(calls.filter(row => row.method === "open").length, 1);
  await nativeBrowser("close"); assert.equal((await nativeBrowser("status")).window, null); assert.equal(calls.filter(row => row.method === "open").length, 1);
  await writeFile(path, Buffer.from(pdf.toString().replace("%%EOF", "changed\n%%EOF")));
  await assert.rejects(nativeArtifact("preview", { url }), /changed after registration/);
 } finally { uninstall?.(); await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("optional runtime absence allows normal browser fallback without a native action", async () => {
 const dir = await mkdtemp(join(tmpdir(), "ibm-native-absent-")); let handle, uninstall;
 try {
  handle = await bootLite({ storageRoot: join(dir, "storage"), coreOnly: true, includePython: false, extraRows: [
   { id: "typert", name: "@deepseek-ai/dsh-typert-registry" }, { id: "gateway", name: "@deepseek-ai/dsh-api-gateway" }, { id: "remote", name: "dsh-lab-agent/remote" }
  ] });
  uninstall = installDesktopClient((method, args) => handle.ctx.typertGateway.invoke({ namespace: "lab", method, args: args?.request ? { request: args.request } : {} }));
  assert.equal(await nativeArtifact("save", { url: "/api/lab-artifacts?kind=pdf&bundleId=fixture" }), null);
  assert.equal(await nativeBrowser("open", { projectId: "fixture" }), null);
 } finally { uninstall?.(); await handle?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("native Office actions preserve optional review, bind approved versions and reject malformed files before staging", async () => {
 const dir=await mkdtemp(join(tmpdir(),"ibm-office-actions-"));let handle,uninstall;
 const calls=[],staged=new Map();
 try{
  handle=await bootLite({storageRoot:join(dir,"storage"),coreOnly:true,includePython:false,extraRows:[
   {id:"runtime",name:"dsh-lab-agent/runtime"},{id:"desktop",name:"dsh-lab-agent/scientific-desktop"},
   {id:"typert",name:"@deepseek-ai/dsh-typert-registry"},{id:"gateway",name:"@deepseek-ai/dsh-api-gateway"},{id:"remote",name:"dsh-lab-agent/remote"}
  ]});
  const {ctx}=handle;await ctx.ibmCore.createProject({id:"office",name:"Isolated Office fixture"});
  ctx.ibmScientificDesktop.broker={dispose:async()=>{},call:async(method,input)=>{
   calls.push(method);
   if(method==="stage"){const fileId=randomUUID();staged.set(fileId,Buffer.from(input.base64,"base64"));return {fileId};}
   if(method==="save")return {cancelled:true};
   if(method==="artifactOpen"){assert.ok(staged.has(input.fileId));return {opened:true};}
   if(method==="discard"){staged.delete(input.fileId);return {discarded:true};}
   throw Error("Unexpected test transport method");
  }};
  uninstall=installDesktopClient((method,args)=>ctx.typertGateway.invoke({namespace:"lab",method,args:args?.request?{request:args.request}:{}}));setDesktopProject("office");
  const md=join(dir,"note.md");await writeFile(md,"# Isolated fixture");
  for(const [kind,extension,bytes] of [["report","docx",(await buildDocx()).buffer],["ppt","pptx",(await buildPptx({name:"fixture",slides:2})).buffer]]){
   const file=join(dir,`fixture.${extension}`);await writeFile(file,bytes);
   const table=ctx.ibmCore.table(kind==="report"?"reports":"presentations");const id=kind==="report"?"office-report":"office-ppt";
   const row={id,projectId:"office",bundleId:"fixture",reportId:"office-report",status:"under-review",createdAt:"2026-10-04",...(kind==="report"?{paperCardPath:md,docxPath:file}:{pptxPath:file})};await table.put(id,row);
   const url=`/api/lab-artifacts?kind=${kind}&format=${extension}&reportId=office-report`;
   assert.equal((await nativeArtifact("open",{url})).opened,true);
   assert.equal((await nativeArtifact("save",{url})).cancelled,true);assert.equal(staged.size,0);assert.equal(table.get(id).status,"under-review");
   await assert.rejects(resolveDesktopArtifact(ctx.ibmCore,url,{requireApproved:true}),/awaiting human review/);
   await table.put(id,{...row,review:{status:"approved",artifactSha256:createHash("sha256").update(bytes).digest("hex")}});
   assert.deepEqual((await resolveDesktopArtifact(ctx.ibmCore,url,{requireApproved:true})).buffer,bytes);
   const modified=kind==="report"?(await buildDocx({title:"Changed"})).buffer:(await buildPptx({name:"Changed",slides:1})).buffer;
   await writeFile(file,modified);
   await assert.rejects(resolveDesktopArtifact(ctx.ibmCore,url,{requireApproved:true}),/changed after review/);
   await writeFile(file,Buffer.from("PK incomplete Office container"));const before=calls.length;
   await assert.rejects(nativeArtifact("open",{url}));assert.equal(calls.length,before);assert.equal(staged.size,0);
  }
 }finally{uninstall?.();await handle?.dispose();await rm(dir,{recursive:true,force:true});}
});
