import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isOwnedPreviewRequest} from '../../electron-next/embedded-preview-policy.mjs';
import {adaptDesktopPreviews} from '../../scripts/desktop-preview-adapter.mjs';

const main={url:'dsh-app://app/',origin:'dsh-app://app',detached:false},owner={id:7,mainFrame:main};
const child={url:'dsh-app://app/api/lab-ketcher/index.html',origin:'dsh-app://app',parent:main,detached:false};
const request=(url,fields={})=>({url,requestHeaders:{},webContentsId:7,resourceType:'script',frame:child,...fields});

test('local preview authentication permits the owned Ketcher document, assets and generated report',()=>{
 assert.equal(isOwnedPreviewRequest(request(child.url,{resourceType:'subFrame',frame:{url:'about:blank',parent:main,detached:false}}),owner),true);
 assert.equal(isOwnedPreviewRequest(request(child.url,{resourceType:'subFrame',frame:main}),owner),true);
 for(const suffix of ['assets/editor.js','assets/indigo.wasm','raphael.min.js'])assert.equal(isOwnedPreviewRequest(request('dsh-app://app/api/lab-ketcher/'+suffix),owner),true);
 for(const url of ['dsh-app://app/api/lab-artifacts?kind=characterization&projectId=p-1&taskId=n-1&slot=report&preview=1','dsh-app://app/api/lab-artifacts?kind=report&reportId=r-1&preview=1'])assert.equal(isOwnedPreviewRequest(request(url,{resourceType:'subFrame',frame:{parent:main}}),owner),true);
});

test('untrusted frames, backend RPC, downloads and external targets never gain the preview marker',()=>{
 for(const candidate of [
  request('dsh-app://app/api/lab/nmr_list'),
  request('dsh-app://app/api/lab-artifacts?kind=report&reportId=r-1&preview=1'),
  request('https://example.org/api/lab-ketcher/editor.js'),
  request(child.url,{resourceType:'mainFrame'}),
  request(child.url,{webContentsId:8}),
  request(child.url,{webContents:{id:8}}),
  request(child.url,{frame:{...child,detached:true}}),
  request(child.url,{frame:{...child,parent:{}}}),
  request(child.url,{frame:{...child,url:'dsh-app://app/other-frame.html'}}),
  request(child.url,{frame:{...child,origin:'https://example.org'}}),
  request('dsh-app://app/api/lab-artifacts?kind=characterization&projectId=p&taskId=n&slot=spectrum&preview=1',{resourceType:'subFrame'}),
  request('dsh-app://app/api/lab-artifacts?kind=report&reportId=../bad&preview=1',{resourceType:'subFrame'}),
  request('dsh-app://app/api/lab-ketcher/../../api/lab/nmr_list')
 ])assert.equal(isOwnedPreviewRequest(candidate,owner),false,JSON.stringify({url:candidate.url,type:candidate.resourceType}));
});

test('PDF viewer may fetch registered PDF/SI documents but cannot invoke application RPC',()=>{
 const frame={...child,url:'dsh-app://app/api/lab-pdf-viewer/index.html'};
 assert.equal(isOwnedPreviewRequest(request('dsh-app://app/api/lab-artifacts?kind=pdf&bundleId=b-1',{frame}),owner),true);
 assert.equal(isOwnedPreviewRequest(request('dsh-app://app/api/lab/nmr_list',{frame}),owner),false);
});

test('desktop adapter preserves the main-frame rule, is idempotent and refuses unknown guards',()=>{
 const guard='request.frame === owner.mainFrame && !request.frame.detached && request.frame.origin === "dsh-app://app"';
 const source=`function appRequestHeaders(request,owner,nativeToken){const headers={};if(owner&&nativeToken&&request.resourceType!=="mainFrame"&&${guard})headers.marker=nativeToken;return headers;}`;
 const adapted=adaptDesktopPreviews(source);
 assert.equal(adaptDesktopPreviews(adapted),adapted);
 assert.ok(adapted.includes(guard));
 const body=adapted.slice(adapted.indexOf('function appRequestHeaders'));
 const headers=new Function('isOwnedPreviewRequest',body+';return appRequestHeaders;')(isOwnedPreviewRequest);
 assert.equal(headers(request('dsh-app://app/api/lab/nmr_list',{frame:main}),owner,'test-marker').marker,'test-marker');
 assert.equal(headers(request(child.url,{resourceType:'subFrame'}),owner,'test-marker').marker,'test-marker');
 assert.equal(headers(request('dsh-app://app/api/lab/nmr_list'),owner,'test-marker').marker,undefined);
 assert.throws(()=>adaptDesktopPreviews('different guard'),/Unexpected/);
});
