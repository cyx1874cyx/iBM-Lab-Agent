/** Official upload transport extension, installed before the Client boots.
 * Keep requests in the owned app document where NEXT supplies authentication.
 * No native token or filesystem capability is exposed to Workers or guests.
 */
if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
 globalThis.__DSH_FILE_UPLOAD__ = Object.freeze({
  fetch(path, init) {
   const url = new URL(path, document.baseURI);
   if (url.protocol !== 'dsh-app:' || url.hostname !== 'app' || url.pathname !== '/api/session/uploadFileBinary' || url.username || url.password) {
    return Promise.reject(new Error('Invalid conversation upload destination'));
   }
   return fetch(url.href, { ...init, credentials: 'include' });
  }
 });
}
