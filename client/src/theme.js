// Alias names verified against the bundled DSH dsh-client-ui-theme implementation.
export const themeCss = `
:root,.ib-overlay,body.ib-research-chat {--ib-bg:var(--dsw-alias-bg-base,#fff);--ib-panel:var(--dsw-alias-bg-layer-1,#f7f7f8);--ib-panel2:var(--dsw-alias-bg-layer-2,#eee);--ib-line:var(--dsw-alias-border-l2,#dcdfe5);--ib-text:var(--dsw-alias-label-primary,#202124);--ib-muted:var(--dsw-alias-label-secondary,#616670);--ib-green:var(--dsw-alias-brand-primary,#4d6bfe);--ib-cyan:var(--dsw-alias-brand-text,#4d6bfe);--ib-red:var(--dsw-alias-state-error-primary,#c33)}
@media(prefers-color-scheme:dark){:root,.ib-overlay,body.ib-research-chat{--ib-bg:var(--dsw-alias-bg-base,#18191b);--ib-panel:var(--dsw-alias-bg-layer-1,#232529);--ib-panel2:var(--dsw-alias-bg-layer-2,#303237);--ib-line:var(--dsw-alias-border-l2,#45474c);--ib-text:var(--dsw-alias-label-primary,#eceef1);--ib-muted:var(--dsw-alias-label-secondary,#b3b6bf)}}
.ib-overlay,body.ib-research-chat{font-family:Arial,"Microsoft YaHei","微软雅黑",sans-serif;color:var(--ib-text);background:var(--ib-bg)}
.ib-overlay :is(button,input,textarea,select),body.ib-research-chat :is(button,input,textarea){font-family:Arial,"Microsoft YaHei","微软雅黑",sans-serif!important}
.ib-overlay :is(input,textarea,select){color:var(--ib-text)!important;background:var(--ib-bg)!important;border-color:var(--ib-line)!important;font-size:13px;line-height:1.6}
.ib-overlay :is(button,summary){transition:background-color 160ms ease,border-color 160ms ease,transform 120ms ease;cursor:pointer}
.ib-overlay button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,var(--ib-panel2));border-color:var(--ib-green)}
.ib-overlay button:active:enabled{transform:translateY(1px)}
.ib-overlay :focus-visible{outline:2px solid var(--ib-green);outline-offset:3px}
.ib-overlay .ib-btn[data-primary=true],.ib-overlay .ib-preview-btn[data-primary=true]{box-shadow:none;background:var(--dsw-alias-button-primary-fill,var(--ib-green));color:var(--dsw-alias-label-primary-inverted,#fff);border-color:transparent}
.ib-overlay :is(.ib-error,[data-danger=true]){color:var(--ib-red)}
.ib-overlay :is(small,time,.ib-muted){color:var(--ib-muted)}
.ib-overlay :is(.ib-card,.ib-board){border-color:var(--ib-line);box-shadow:none}
.ib-overlay :is(.ib-empty,.ib-row,.ib-btn){font-size:13px}
.ib-overlay .sw-struct-card img,.ib-overlay .sw-struct-fallback{background:#fff!important;color:#333!important}
.ib-overlay .sw-struct-card{background:var(--ib-panel)}
.sw-step-chem-arrow{min-width:40px;flex:0 0 40px}.sw-step-chem{gap:16px}
.ib-memory-drawer{position:fixed;right:20px;top:90px;bottom:24px;width:min(600px,calc(100vw - 40px));z-index:1100;overflow:auto;background:var(--ib-panel);border:1px solid var(--ib-line);border-radius:14px;padding:16px;box-sizing:border-box;box-shadow:0 16px 50px #0003;animation:ib-panel-enter 160ms ease}
.ib-memory-drawer textarea{box-sizing:border-box;width:100%;min-height:42vh;border:1px solid var(--ib-line);border-radius:10px;padding:14px}.ib-memory-close{float:right;margin-bottom:12px}
.ib-characterization{display:grid;gap:16px}.ib-characterization h3{margin:0;font-size:16px}.ib-characterization-row{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--ib-line);flex-wrap:wrap}.ib-characterization-title{display:grid;gap:5px;flex:1;min-width:160px}.ib-characterization-title b{font-size:14px}.ib-characterization-title time{font-size:12px}.ib-nmr-structure{width:130px}.ib-nmr-structure .sw-struct-card{min-width:0;max-width:130px;border:0;padding:0}.ib-nmr-structure .sw-struct-card img{height:80px}.ib-nmr-structure .sw-struct-name{display:none}.ib-entry-details{font-size:12px}.ib-entry-edit{display:flex;flex-wrap:wrap;gap:8px;padding:10px 0}.ib-task-form{animation:ib-panel-enter 160ms ease}.ib-task-form textarea{width:100%;min-height:90px;box-sizing:border-box}.ib-task-form label{margin:10px 0}
.ib-overlay .ib-tab{background:var(--ib-bg);padding:14px 16px}.ib-overlay .ib-tab strong{font-size:14px}.ib-overlay .ib-tab span{font-size:12px;color:var(--ib-muted)}
.ib-overlay .ib-tab[data-active=true],.ib-overlay .ib-tm-tab[data-active=true]{background:var(--dsw-alias-button-ghost-active-fill,var(--ib-panel2));border-color:var(--dsw-alias-button-ghost-active-border,var(--ib-green));box-shadow:inset 0 -2px var(--ib-green)}
.ib-overlay .ib-project-copy p,.ib-overlay .ib-board-head p{font-size:12px;color:var(--ib-muted)}.ib-overlay .ib-board-head h2{font-size:16px}.ib-overlay .ib-btn{background:var(--ib-bg);box-shadow:none}
@keyframes ib-panel-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@media(max-width:720px){.ib-form-grid{grid-template-columns:1fr}.ib-project-head{flex-wrap:wrap}.ib-characterization-row{gap:8px}.ib-top{padding-inline:12px}.ib-frame{padding-inline:12px}}
@media(prefers-reduced-motion:reduce){.ib-overlay *,.ib-overlay *::before,.ib-overlay *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
