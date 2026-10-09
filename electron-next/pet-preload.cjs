const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ibmPet',{
 hide:()=>ipcRenderer.send('ibm:pet-action','hide'),openMain:()=>ipcRenderer.send('ibm:pet-action','main'),
 beginDrag:(x,y)=>ipcRenderer.send('ibm:pet-drag',{phase:'start',x,y}),
 drag:(x,y)=>ipcRenderer.send('ibm:pet-drag',{phase:'move',x,y}),
 endDrag:()=>ipcRenderer.send('ibm:pet-drag',{phase:'end'})
});
