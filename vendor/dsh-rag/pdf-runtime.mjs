import geometry from './geometry.cjs';
// PDF text extraction uses geometry, without requiring a native canvas renderer.
globalThis.DOMMatrix??=geometry.DOMMatrix;
const {getDocument}=await import('./pdf.mjs');
export {getDocument};
