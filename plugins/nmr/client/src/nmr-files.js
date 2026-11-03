export const NMR_DATA_ACCEPT='.zip,.mnova,.jdx,.dx,.jcamp';
export const NMR_STRUCTURE_ACCEPT='.mol,.sdf,.cdx,.cdxml,.mrv,.cml,.smi,.smiles,.inchi';
export const isNmrData=name=>/\.(zip|mnova|jdx|dx|jcamp)$/i.test(name);
export const isNmrStructure=name=>/\.(mol|sdf|cdx|cdxml|mrv|cml|smi|smiles|inchi)$/i.test(name);

/** Read drop entries while the drag store is available; retain the entire vendor directory. */
export function nmrDropFiles(dataTransfer){
 const entries=Array.from(dataTransfer.items||[]).map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
 if(!entries.some(entry=>entry.isDirectory))return Promise.resolve(Array.from(dataTransfer.files||[]));
 return Promise.all(entries.map(async entry=>{
  if(entry.isFile)return new Promise((resolve,reject)=>entry.file(resolve,reject));
  const {default:JSZip}=await import('jszip'),zip=new JSZip();
  let count=0,total=0;
  const visit=async(node,path)=>{
   if(node.isFile){
    const file=await new Promise((resolve,reject)=>node.file(resolve,reject));
    count++;total+=file.size;
    if(count>5000||total>25*1024*1024)throw Error('FID 目录超过 25 MB 或文件数量过多，请先压缩为 ZIP 后选择文件');
    zip.file(path,await file.arrayBuffer());return;
   }
   const reader=node.createReader();
   for(;;){const children=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!children.length)break;for(const child of children)await visit(child,path+'/'+child.name);}
  };
  await visit(entry,entry.name);
  return new File([await zip.generateAsync({type:'blob',compression:'DEFLATE'})],entry.name+'.zip',{type:'application/zip'});
 }));
}
