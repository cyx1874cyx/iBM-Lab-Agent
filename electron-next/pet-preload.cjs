const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ibmPet',{hide:()=>ipcRenderer.send('ibm:pet-action','hide'),openMain:()=>ipcRenderer.send('ibm:pet-action','main')});
