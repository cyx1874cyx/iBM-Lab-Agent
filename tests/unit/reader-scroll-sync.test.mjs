import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pdfPosition,scrollPdfTo,createPdfScrollSync} from '../../client/src/reader-scroll-sync.js';
const flow=height=>({clientHeight:500,scrollTop:0,scrollHeight:12+6*(height+14),children:Array.from({length:6},(_,i)=>({dataset:{pdfPage:String(i+1)},offsetTop:12+i*(height+14),offsetHeight:height}))});
test('PDF anchors preserve page and fraction across different pane sizes and clamp page inputs',()=>{
 const left=flow(800),right=flow(1200);scrollPdfTo(left,{page:3,fraction:.4});scrollPdfTo(right,pdfPosition(left));
 assert.deepEqual(pdfPosition(right),{page:3,fraction:.4});assert.notEqual(left.scrollTop,right.scrollTop);
 scrollPdfTo(left,{page:100,fraction:2});assert.equal(left.scrollTop,left.scrollHeight-left.clientHeight);
 scrollPdfTo(left,{page:-10});assert.equal(left.scrollTop,0);
});
test('linked scroll coalesces rapid input, ignores late programmatic echoes and supports either pane',()=>{
 const panes={original:flow(800),zh:flow(1200)},frames=new Map();let sequence=0,linked=true,published=0;
 const sync=createPdfScrollSync({flowFor:side=>panes[side],linked:()=>linked,onPosition:()=>published++,requestFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelFrame:id=>frames.delete(id)});
 const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
 for(const fraction of [.1,.2,.4]){scrollPdfTo(panes.original,{page:3,fraction});sync.onScroll('original',panes.original);}assert.equal(frames.size,1);flush();
 assert.deepEqual(pdfPosition(panes.zh),{page:3,fraction:.4});const top=panes.original.scrollTop;
 // Scroll events may arrive several frames after the programmatic write.
 sync.onScroll('zh',panes.zh);flush();sync.onScroll('zh',panes.zh);flush();assert.equal(published,1);assert.equal(panes.original.scrollTop,top);
 scrollPdfTo(panes.zh,{page:4,fraction:.5});sync.onScroll('zh',panes.zh);flush();assert.deepEqual(pdfPosition(panes.original),{page:4,fraction:.5});
 linked=false;const right=panes.zh.scrollTop;scrollPdfTo(panes.original,{page:2});sync.onScroll('original',panes.original);flush();assert.equal(panes.zh.scrollTop,right);
 linked=true;sync.move('original',sync.capture('original'));assert.equal(pdfPosition(panes.zh).page,2);
 sync.onScroll('original',{...panes.original,scrollTop:100});sync.dispose();assert.equal(frames.size,0);
});
