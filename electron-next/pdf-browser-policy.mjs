export const NATIVE_PDF_ORIGIN='chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
/** Chromium's PDF UI imports chrome://resources; ordinary research pages cannot. */
export function nativePdfResource(details){
 try{const url=new URL(details.url);return url.protocol==='chrome-extension:'&&url.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai'||url.protocol==='chrome:'&&url.hostname==='resources'&&String(details.frame?.url??'').startsWith(NATIVE_PDF_ORIGIN);}catch{return false;}
}
