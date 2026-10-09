import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Compatibility extension for the pinned DSH 0.2.0-rc.2 document preview.
// Keep native Office/PDF implementations and lifecycle faces inside their owning
// package. A Component Factory can be embedded without claiming its global slots.
export function withOfficePreviewFactory(source){
 assert.equal(createHash('sha256').update(source).digest('hex'),'2ac3abbac1be8ee57a5fabef8c2bbefaa365b21c15597005baa1d5c2a9383f0f','DSH preview bundle differs from the pinned upstream; review the adapter');
 const anchor='\t\t\tconst pdfPresentation = pdfBodyRegistration(ctx);';
 assert.equal(source.split(anchor).length,2,'DSH Office registration changed; review the adapter before upgrading');
 const addition=`
            // iBM: reusable native Office preview, same conversion/cache face.
            ctx.effect(() => ctx.slots.registerFactory({
                name: "ibm.office.preview", scope: "session", locale: "sidebarOffice", store,
                inject: (sessionId, actions) => ({
                    ...face(sessionId, actions),
                    retainTab: (tabId, signal) => retainTab(tabId, signal, actions.forget)
                })
            }, function EmbeddedOffice(props) {
                return react_jsx_runtime.jsx(OfficeBody, {...props,
                    renderSlot: (_name, owner, options) => props.renderFactorySlot("ibm.office.preview.pdf", {
                        ...owner, useTabInfo: options.hookContext
                    })
                });
            }));
            ctx.effect(() => ctx.slots.registerFactory({
                name: "ibm.office.preview.pdf", scope: "session", locale: "sidebarPdf",
                ...pdfBodyRegistration(ctx)
            }, LazyPdfBody));
`;
 return source.replace(anchor,addition+anchor);
}
