const APP_ORIGIN='dsh-app://app';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function local(value){
 try{const url=new URL(value);return url.protocol==='dsh-app:'&&url.host==='app'&&!url.username&&!url.password?url:null;}
 catch{return null;}
}
function viewer(url){
 if(['/api/lab-ketcher/index.html','/api/lab-pdf-viewer/index.html'].includes(url.pathname))return true;
 if(url.pathname!=='/api/lab-artifacts'||url.searchParams.get('preview')!=='1')return false;
 const kind=url.searchParams.get('kind');
 if(['report','ppt'].includes(kind))return ID.test(url.searchParams.get('reportId')||'');
 return kind==='characterization'&&url.searchParams.get('slot')==='report'&&ID.test(url.searchParams.get('taskId')||'')&&ID.test(url.searchParams.get('projectId')||'');
}

/** Only direct, application-owned viewers get access to their own static assets / document. */
export function isOwnedPreviewRequest(request,owner){
 const target=local(request.url),frame=request.frame;
 if(!target||!owner||request.webContentsId!==owner.id||request.webContents&&request.webContents.id!==owner.id||!frame||frame.detached||request.resourceType==='mainFrame'||!local(owner.mainFrame?.url))return false;
 // For a subframe navigation Electron may identify either its initiating main frame
 // or the child whose initial origin is still about:blank. Validate the parent identity.
 if(request.resourceType==='subFrame')return viewer(target)&&(frame===owner.mainFrame||frame.parent===owner.mainFrame);
 if(frame.parent!==owner.mainFrame||frame.origin!==APP_ORIGIN)return false;
 const source=local(frame.url);if(!source||!viewer(source))return false;
 if(source.pathname==='/api/lab-ketcher/index.html')return target.pathname.startsWith('/api/lab-ketcher/');
 if(source.pathname==='/api/lab-pdf-viewer/index.html')return target.pathname.startsWith('/api/lab-pdf-viewer/')||target.pathname==='/api/lab-artifacts'&&['pdf','si'].includes(target.searchParams.get('kind'))&&ID.test(target.searchParams.get('bundleId')||'');
 return false;
}
