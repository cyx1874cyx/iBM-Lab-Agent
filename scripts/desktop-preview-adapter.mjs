/** Keep the host's main-frame authentication rule; add a bounded local-viewer rule. */
export function adaptDesktopPreviews(source){
 if(source.includes('/* ibm-owned-preview-v1 */'))return source;
 const guard='request.frame === owner.mainFrame && !request.frame.detached && request.frame.origin === "dsh-app://app"';
 if(source.split(guard).length!==2)throw Error('Unexpected desktop frame-authentication guard; preview adapter was not applied');
 const adapted=source.replace(guard,'('+guard+' || isOwnedPreviewRequest(request, owner))');
 return '/* ibm-owned-preview-v1 */\nimport {isOwnedPreviewRequest} from "../node_modules/dsh-lab-agent/electron-next/embedded-preview-policy.mjs";\n'+adapted;
}
