export const nmrCss=`
.ib-overlay .ib-nmr-form.ib-nmr-simulation{width:min(1280px,100%)}
.ib-overlay .ib-nmr-form.ib-nmr-sim-settings{width:min(500px,100%)}
.ib-overlay .ib-nmr-form.ib-nmr-delete-dialog{width:min(540px,100%)}
.ib-overlay .ib-nmr-delete-options{display:grid;gap:12px;margin:16px 0}
.ib-overlay .ib-nmr-delete-options label{display:flex;align-items:center;gap:10px}
.ib-overlay .ib-nmr-delete-options input[type=checkbox]{width:auto;flex:none}
.ib-overlay .ib-nmr-sim-settings select{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--ib-line);border-radius:7px;background:var(--ib-bg);color:var(--ib-text);font:inherit}
.ib-overlay .ib-nmr-sim-settings input[type=checkbox]{width:auto}
.ib-overlay .ib-nmr-sim-structure{width:100%;height:180px;object-fit:contain;background:white;border-radius:8px}
.ib-overlay .ib-nmr-sim-layout{display:grid;grid-template-columns:minmax(270px,340px) minmax(0,1fr);gap:24px}
.ib-overlay .ib-nmr-sim-layout .ib-field{margin:10px 0}
.ib-overlay .ib-nmr-sim-layout input,.ib-overlay .ib-nmr-sim-layout select{max-width:100%;box-sizing:border-box}
.ib-overlay .ib-nmr-sim-result{min-width:0;overflow:auto}
.ib-overlay .ib-nmr-sim-spectrum{width:100%;background:white;border-radius:8px}
.ib-overlay .ib-nmr-sim-exports{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.ib-overlay .ib-nmr-sim-result table{width:100%;border-collapse:collapse;font-size:13px}
.ib-overlay .ib-nmr-sim-result td,.ib-overlay .ib-nmr-sim-result th{padding:7px;border-bottom:1px solid var(--ib-hair);text-align:left}
@media(max-width:800px){.ib-overlay .ib-nmr-sim-layout{grid-template-columns:1fr}}
.ib-overlay .ib-nmr-panel{min-height:100%;box-sizing:border-box;padding:0 0 40px;position:relative}
.ib-overlay .ib-nmr-list{display:grid;margin-top:14px;container-type:inline-size}
.ib-overlay .ib-nmr-entry{display:grid;grid-template-columns:180px minmax(0,1fr) auto;align-items:center;gap:20px;padding:18px 12px;border-bottom:1px solid var(--ib-hair);background:var(--ib-row-base)}
.ib-overlay .ib-nmr-entry:nth-child(even){background:var(--ib-row-alt)}
.ib-overlay .ib-nmr-entry:is([data-status=queued],[data-status=running]){background:var(--ib-row-alt)}
.ib-overlay .ib-nmr-entry:hover{background:var(--ib-accent-soft)}
.ib-overlay .ib-nmr-molecule{display:grid;place-items:center;min-width:0;min-height:120px;max-height:200px;padding:10px;background:#fff;border-radius:8px;color:var(--ib-soft);font-size:14px;text-align:center}
.ib-overlay .ib-nmr-molecule img{display:block;max-width:100%;max-height:180px;object-fit:contain}
.ib-overlay .ib-nmr-identity{display:grid;gap:7px;min-width:0;overflow-wrap:anywhere}
.ib-overlay .ib-nmr-identity b{font-size:18px;line-height:1.5}
.ib-overlay .ib-nmr-identity>span{font-size:16px;color:var(--ib-soft)}
.ib-overlay .ib-nmr-identity small{display:flex;align-items:center;gap:7px;color:var(--ib-soft);font-size:14px}
.ib-overlay .ib-nmr-date{color:var(--ib-soft);font-size:14px;line-height:1.5}
.ib-overlay .ib-nmr-identity small[data-status=failed]{color:var(--ib-red)}
.ib-overlay .ib-nmr-analysis{display:flex;align-items:center;justify-self:start;gap:7px;border:1px solid var(--ib-accent);border-radius:7px;background:var(--ib-accent);color:#fff;padding:7px 12px;font:inherit;font-size:14px;cursor:pointer}
.ib-overlay .ib-nmr-analysis[data-active=true]{color:var(--ib-accent-ink);background:var(--ib-accent-soft)}
.ib-overlay .ib-nmr-analysis:disabled{opacity:.6;cursor:wait}
.ib-overlay .ib-nmr-analysis:hover:enabled{filter:brightness(.94)}
.ib-overlay .ib-nmr-actions{display:flex;gap:8px;flex-wrap:nowrap;width:auto;max-width:100%;overflow-x:auto;align-items:center}
.ib-overlay .ib-nmr-actions .ib-icon-btn{box-sizing:border-box;flex:none}
.ib-overlay .ib-nmr-actions .ib-icon-btn[aria-label="模拟谱 · Mnova"][data-ready=false]{color:#858b8e;background:#eceeef;border-color:#c9ced0;opacity:1}
.ib-overlay .ib-nmr-actions .ib-icon-btn:disabled{opacity:.4;cursor:default}
.ib-overlay .ib-nmr-working{display:flex;align-items:center;gap:10px;color:var(--ib-soft);padding:14px 0}
.ib-overlay.ib-nmr-modal-backdrop{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;background:#0005;padding:24px;box-sizing:border-box}
.ib-overlay .ib-nmr-form{width:min(860px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--ib-bg);border:1px solid var(--ib-hair);border-radius:14px;padding:24px;box-sizing:border-box}
.ib-overlay .ib-nmr-form h3{margin:0 0 18px;font-size:21px}
.ib-overlay .ib-nmr-input-zones{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-bottom:22px}
.ib-overlay .ib-nmr-input-zone{display:flex;flex-direction:column;align-items:stretch;min-width:0;border:2px dashed var(--ib-line);border-radius:12px;background:var(--ib-bg);overflow:hidden}
.ib-overlay .ib-nmr-input-zone:is([data-selected=true],[data-dragging=true]){border-color:var(--ib-accent);background:var(--ib-accent-soft)}
.ib-overlay .ib-nmr-input-zone[data-dragging=true]{box-shadow:inset 0 0 0 1px var(--ib-accent)}
.ib-overlay .ib-nmr-input-pick{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;width:100%;min-height:205px;padding:22px 16px;border:0;background:transparent;color:var(--ib-accent-ink);cursor:pointer;font:inherit;text-align:center}
.ib-overlay .ib-nmr-input-pick b{font-size:18px;color:var(--ib-text)}
.ib-overlay .ib-nmr-input-name{font-size:15px;line-height:1.5;overflow-wrap:anywhere;max-width:100%}
.ib-overlay .ib-nmr-input-pick small{color:var(--ib-soft);font-size:13px;line-height:1.5}
.ib-overlay .ib-nmr-input-pick:hover:enabled{background:var(--ib-accent-soft)}
.ib-overlay .ib-nmr-draw-button{align-self:center;margin:0 16px 16px}
.ib-overlay .ib-nmr-input-zone input[hidden]{display:none}
.ib-overlay .ib-nmr-input-progress{margin-right:auto;color:var(--ib-soft);font-size:14px;align-self:center}
.ib-overlay .ib-nmr-more-inputs{margin-top:4px}
.ib-overlay .ib-nmr-more-inputs summary{color:var(--ib-soft);font-size:15px;margin-bottom:12px;cursor:pointer}
.ib-overlay .ib-nmr-form .ib-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:16px}
.ib-overlay .ib-nmr-form .ib-field{display:grid;gap:6px;min-width:0;font-size:15px}
.ib-overlay .ib-nmr-form :is(input,textarea){width:100%;box-sizing:border-box;min-width:0;font-size:15px!important;padding:8px 10px;border:1px solid var(--ib-line);border-radius:7px}
.ib-overlay .ib-nmr-form textarea{min-height:90px;resize:vertical;margin-top:6px}
.ib-overlay .ib-nmr-form .ib-form-foot{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:18px}
.ib-overlay .ib-nmr-preview{display:flex;flex-direction:column;width:min(1100px,100%);height:min(850px,calc(100vh - 48px));background:var(--ib-bg);border:1px solid var(--ib-hair);border-radius:14px;overflow:hidden}
.ib-overlay .ib-nmr-preview header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;border-bottom:1px solid var(--ib-hair);font-size:18px}
.ib-overlay .ib-nmr-preview iframe{flex:1;min-height:0;width:100%;border:0}
.ib-overlay .ib-nmr-preview .ib-nmr-molecule{flex:1;max-height:none;min-height:0;border-radius:0}
.ib-overlay .ib-nmr-molecule[data-large] img{width:100%;height:100%;max-height:100%;max-width:100%;object-fit:contain;padding:30px;box-sizing:border-box}
.ib-overlay.ib-nmr-drawing{position:fixed;inset:0;z-index:9500;background:transparent;pointer-events:none}
.ib-nmr-drawing>*{pointer-events:auto}
@container(max-width:650px){.ib-overlay .ib-nmr-entry{grid-template-columns:130px minmax(0,1fr);gap:12px}.ib-overlay .ib-nmr-actions{grid-column:2}.ib-overlay .ib-nmr-molecule{grid-row:span 2}}
@container(max-width:380px){.ib-overlay .ib-nmr-entry{grid-template-columns:minmax(0,1fr)}.ib-overlay .ib-nmr-actions{grid-column:1}.ib-overlay .ib-nmr-molecule{grid-row:auto}}
@media(max-width:600px){.ib-overlay .ib-nmr-form .ib-form-grid,.ib-overlay .ib-nmr-input-zones{grid-template-columns:minmax(0,1fr)}.ib-overlay .ib-nmr-input-pick{min-height:165px}}
`;
