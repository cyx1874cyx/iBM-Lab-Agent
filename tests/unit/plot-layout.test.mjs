import {test} from 'node:test';import assert from 'node:assert/strict';
import {layoutDocSchema,layoutSource,gridObjects,arrangeObjects,reflowGroups,panelLabel,expandSelection,snapMove,outsidePage} from '../../src/plot/layout.js';
const seed=()=>layoutDocSchema.parse({page:{w:180,h:120},objects:[0,1,2].map(i=>({type:'panel',id:'p'+i,assetId:'a'+i,x:10+i*40,y:10+i,w:30,h:20}))});
test('all rendered Origin kinds, raster formats and composites are layout candidates',()=>{
 for(const kind of ['line','line_symbol','scatter','column','bar','box','histogram'])assert.ok(layoutSource({workflow:{spec:{kind,yCols:[1]},saved:{preview:{}}}}));
 for(const format of ['PNG','JPEG','WEBP','TIFF','BMP','GIF'])assert.equal(layoutSource({image:{format}}).kind,format);
 assert.ok(layoutSource({layout:{}}));assert.equal(layoutSource({workflow:{raw:{}}}),null);assert.equal(panelLabel(0),'(a)');assert.equal(panelLabel(26),'(aa)');
});
test('millimetre grids and alignment preserve aspect, pins and exact gaps',()=>{
 let doc=seed();assert.equal(layoutDocSchema.parse({}).page.w,180);doc=gridObjects(doc,['p0','p1','p2'],2,4);assert.deepEqual(outsidePage(doc),[]);assert.ok(Math.abs(doc.objects[0].w/doc.objects[0].h-1.5)<1e-9);
 doc=arrangeObjects(seed(),['p0','p1','p2'],'top');assert.deepEqual(doc.objects.map(o=>o.y),[10,10,10]);doc=arrangeObjects(doc,['p0','p1','p2'],'hgap','selection','p0',3);assert.equal(doc.objects[1].x-doc.objects[0].x-doc.objects[0].w,3);
 doc=arrangeObjects(doc,['p0'],'right','page');assert.equal(doc.objects[0].x+doc.objects[0].w,180);
});
test('layout groups reflow resized members without moving pinned objects',()=>{
 let doc=seed();doc.objects.forEach(o=>{o.groupId='g';});doc.groups=[{id:'g',mode:'row',order:['p0','p1','p2'],gap:5,columns:2,align:'start',uniform:'none'}];doc.objects[0].w=50;doc=reflowGroups(doc);assert.equal(doc.objects[1].x,65);assert.equal(doc.objects[2].x,100);
 doc.objects[1].pinned=true;doc.objects[0].w=40;doc=reflowGroups(doc);assert.equal(doc.objects[1].x,65);assert.deepEqual(expandSelection(doc,['p0']),['p0','p1','p2']);
 const snapped=snapMove(seed(),{id:'p0',w:30,h:20},9.5,9.6,['p0']);assert.ok(Number.isFinite(snapped.x)&&Number.isFinite(snapped.y));
});
test('aligning or fitting a group keeps its members together as one unit',()=>{
 const doc=seed();doc.objects[0].groupId='g';doc.objects[1].groupId='g';const gap=doc.objects[1].x-doc.objects[0].x;
 const aligned=arrangeObjects(doc,['p0','p1'],'right','page');assert.equal(aligned.objects[1].x-aligned.objects[0].x,gap);assert.equal(aligned.objects[1].x+aligned.objects[1].w,180);
 const fitted=gridObjects(doc,['p0','p1','p2'],2,3);assert.ok(Math.abs(fitted.objects[0].w/fitted.objects[1].w-1)<1e-9);assert.equal(outsidePage(fitted).length,0);
});
