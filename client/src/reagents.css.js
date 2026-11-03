export const reagentsCss=`
.ib-overlay .ib-reagents{container-type:inline-size;padding:0 0 28px;font-size:16px}
.ib-overlay .ib-reagent-search-label{display:block;font-size:18px;font-weight:600;margin-bottom:12px}
.ib-overlay .ib-reagent-search-line{display:flex;gap:12px;align-items:center}
.ib-overlay .ib-reagent-search input{flex:1;min-width:0;height:46px;border:1px solid var(--ib-line);border-radius:8px;padding:10px 14px;background:var(--ib-bg);color:var(--ib-text);font:inherit}
.ib-overlay .ib-reagent-search input:focus{outline:2px solid var(--ib-accent);outline-offset:1px}
.ib-overlay .ib-reagent-filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0}
.ib-overlay .ib-reagent-kinds{display:flex;gap:7px;flex-wrap:wrap;margin-right:auto}
.ib-overlay .ib-reagent-kinds button{display:flex;gap:8px;align-items:center}
.ib-overlay .ib-reagent-kinds button[aria-pressed=true]{background:var(--ib-accent-soft);color:var(--ib-accent-ink);border-color:var(--ib-accent)}
.ib-overlay .ib-reagent-kinds button span{font-size:13px;opacity:.8}
.ib-overlay .ib-reagent-filters label{display:flex;gap:7px;align-items:center;font-size:14px;min-width:0}
.ib-overlay .ib-reagent-filters select{min-height:35px;max-width:230px;border:1px solid var(--ib-line);border-radius:7px;background:var(--ib-bg);color:var(--ib-text);padding:5px 7px;font:inherit}
.ib-overlay .ib-reagent-sources{border-bottom:1px solid var(--ib-hair);padding:4px 0 16px;margin-bottom:18px;font-size:14px}
.ib-overlay .ib-reagent-sources summary{cursor:pointer;color:var(--ib-text)}
.ib-overlay .ib-reagent-sources summary>span{margin-left:14px;color:var(--ib-soft);font-size:13px}
.ib-overlay .ib-reagent-source{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0 0}
.ib-overlay .ib-reagent-source>div:first-child{display:grid;gap:4px;min-width:0;overflow-wrap:anywhere}
.ib-overlay .ib-reagent-source>div:last-child{display:flex;gap:8px;flex-shrink:0}
.ib-overlay .ib-reagent-source small{color:var(--ib-soft);font-size:13px}
.ib-overlay .ib-reagent-source-warning{padding:10px 12px;border:1px solid var(--ib-line);background:var(--ib-accent-soft);border-radius:7px;font-size:14px;margin-bottom:12px}
.ib-overlay .ib-reagent-results-head{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:15px}
.ib-overlay .ib-reagent-results-head span{color:var(--ib-soft);font-size:13px}
.ib-overlay .ib-reagent-row{display:grid;grid-template-columns:minmax(200px,2fr) minmax(110px,1fr) minmax(110px,1fr) 85px auto;gap:16px;align-items:center;padding:18px 12px;border-bottom:1px solid var(--ib-hair);background:var(--ib-row-base);overflow-wrap:anywhere}
.ib-overlay .ib-reagent-row:nth-child(even){background:var(--ib-row-alt)}
.ib-overlay .ib-reagent-row:hover{background:var(--ib-accent-soft)}
.ib-overlay .ib-reagent-row>div{display:grid;gap:6px;min-width:0;line-height:1.6}
.ib-overlay .ib-reagent-name{display:block;text-align:left;border:0;background:transparent;color:var(--ib-text);font:inherit;font-size:17px;font-weight:600;padding:0;cursor:pointer;overflow-wrap:anywhere;line-height:1.6}
.ib-overlay .ib-reagent-name:hover{color:var(--ib-accent-ink)}
.ib-overlay .ib-reagent-identifiers{display:flex;gap:4px 12px;flex-wrap:wrap;font-size:14px;color:var(--ib-soft)}
.ib-overlay .ib-reagent-row small{font-size:13px;color:var(--ib-soft)}
.ib-overlay .ib-reagent-row small[data-used=true]{color:var(--ib-red)}
.ib-overlay .ib-reagent-pagination{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:18px 0;font-size:14px;color:var(--ib-soft)}
.ib-overlay.ib-reagent-modal{position:fixed;inset:0;z-index:9000;background:#0005;display:grid;place-items:center;padding:24px;box-sizing:border-box}
.ib-overlay .ib-reagent-detail{width:min(800px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid var(--ib-line);border-radius:13px;background:var(--ib-bg);padding:24px;box-sizing:border-box}
.ib-overlay .ib-reagent-detail header{display:flex;align-items:flex-start;gap:16px;justify-content:space-between}
.ib-overlay .ib-reagent-detail h2{font-size:22px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.ib-overlay .ib-reagent-detail p{font-size:14px;color:var(--ib-soft);overflow-wrap:anywhere}
.ib-overlay .ib-reagent-detail dl>div{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;padding:10px 0;border-top:1px solid var(--ib-hair);font-size:15px;line-height:1.6}
.ib-overlay .ib-reagent-detail dt{color:var(--ib-soft)}
.ib-overlay .ib-reagent-detail dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.ib-overlay .ib-reagent-detail dd small{display:block;color:var(--ib-soft);font-size:13px;margin-top:4px}
.ib-overlay .ib-reagent-detail footer{display:flex;justify-content:flex-end;margin-top:18px}
@container(max-width:850px){.ib-overlay .ib-reagent-row{grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:12px}.ib-overlay .ib-reagent-main{grid-column:1/3}.ib-overlay .ib-reagent-row>button{grid-column:3;grid-row:1}.ib-overlay .ib-reagent-stock{grid-column:3}.ib-overlay .ib-reagent-sources summary>span{display:block;margin:6px 0 0 16px}}
@container(max-width:450px){.ib-overlay .ib-reagent-row{grid-template-columns:minmax(0,1fr) auto}.ib-overlay .ib-reagent-main{grid-column:1}.ib-overlay .ib-reagent-row>button{grid-column:2}.ib-overlay .ib-reagent-stock{grid-column:2;grid-row:2}.ib-overlay .ib-reagent-place{grid-column:1/3}.ib-overlay .ib-reagent-filters label{flex-wrap:wrap}.ib-overlay .ib-reagent-filters select{max-width:100%}.ib-overlay .ib-reagent-source{align-items:flex-start;flex-wrap:wrap}.ib-overlay .ib-reagent-results-head{align-items:flex-start;flex-direction:column;gap:4px}}
@media(max-width:600px){.ib-overlay .ib-reagent-detail dl>div{grid-template-columns:100px minmax(0,1fr);gap:10px}}
`;
