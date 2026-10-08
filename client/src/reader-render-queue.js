/** Bound expensive canvas/text work across the two PDF panes. */
export function createRenderQueue(limit=2){
 let active=0;const pending=[];
 const drain=()=>{while(active<limit&&pending.length){const row=pending.shift();if(row.cancelled){row.resolve();continue;}active++;Promise.resolve().then(()=>row.cancelled?undefined:row.work()).then(row.resolve,row.reject).finally(()=>{active--;drain();});}};
 return work=>{let row;const promise=new Promise((resolve,reject)=>{row={work,resolve,reject,cancelled:false};pending.push(row);drain();});return {promise,cancel:()=>{row.cancelled=true;}};};
}
export const queuePdfRender=createRenderQueue(2);
