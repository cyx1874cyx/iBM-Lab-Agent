export const workbenchCss = `
html[data-windows-titlebar] .ib-wb{padding-top:var(--dsh-windows-titlebar-height,40px);box-sizing:border-box}
html[data-windows-titlebar] .ib-wb-history{top:calc(54px + var(--dsh-windows-titlebar-height,40px))}
.ib-wb-titlebar{display:none}
html[data-windows-titlebar] .ib-wb-titlebar{display:block;position:absolute;top:0;left:env(titlebar-area-x,0px);width:env(titlebar-area-width,calc(100% - 138px));height:var(--dsh-windows-titlebar-height,40px);z-index:20;-webkit-app-region:drag;user-select:none}
.ib-wb-top{-webkit-app-region:drag;user-select:none}
.ib-wb-top :is(button,a,input,textarea,select,[role=button],[contenteditable]){-webkit-app-region:no-drag}
.ib-wb-module-tools{display:flex;justify-content:flex-end;margin:-8px 0 12px}
.ib-wb-project-holder,.ib-wb-project-seat{height:100%;min-height:0}.ib-wb-project-page{height:100%;min-height:0;display:flex;flex-direction:column}.ib-wb-project-page>.ib-project-head,.ib-wb-project-page>.ib-wb-module-tools{flex:none}.ib-wb-project-page>.ib-tab-panel{flex:1;min-height:0;overflow:auto;padding-right:3px}
.ib-wb{height:100%;min-height:0;display:grid;grid-template-columns:190px minmax(0,1fr) 5px minmax(320px,min(var(--ib-wb-chat-width,380px),45vw));grid-template-rows:54px minmax(0,1fr);background:var(--ib-bg);color:var(--ib-text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;position:relative;isolation:isolate;--dsh-windows-sidebar-width:190px}
.ib-wb *{box-sizing:border-box}.ib-wb [hidden]{display:none!important}.ib-wb button{font-family:inherit}.ib-wb button:focus-visible,.ib-wb [role=separator]:focus-visible{outline:2px solid var(--ib-accent);outline-offset:-2px}
.ib-wb-top{grid-column:1/-1;display:flex;align-items:center;gap:16px;padding:0 18px;border-bottom:1px solid var(--ib-hair);background:var(--ib-bg);z-index:10}.ib-wb-brand{display:flex;align-items:center;gap:9px;color:var(--ib-text);font-size:17px;font-weight:650;background:none;border:0;padding:0;cursor:pointer;letter-spacing:-.5px;white-space:nowrap}.ib-wb-brand-mark{width:29px;height:29px;display:grid;place-items:center;border-radius:8px;background:var(--ib-accent);color:white}.ib-wb-top-divider{width:1px;height:20px;background:var(--ib-hair);margin:0 2px 0 20px}.ib-wb-project-picker{display:flex;align-items:center;gap:16px;border:0;background:none;color:var(--ib-soft);font-size:13px;cursor:pointer;max-width:40vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-wb-top-spacer{flex:1}.ib-wb-dev-label{font-size:12px;color:var(--ib-soft)}.ib-wb-tool{border:1px solid var(--ib-hair);background:var(--ib-bg);color:var(--ib-soft);border-radius:7px;padding:5px 10px;cursor:pointer;font-size:12px;white-space:nowrap}.ib-wb-tool:hover{background:var(--ib-hover)}
.ib-wb-nav{grid-column:1;grid-row:2;display:flex;flex-direction:column;min-height:0;padding:23px 10px 14px;background:var(--ib-panel);border-right:1px solid var(--ib-hair)}.ib-wb-nav-label{font-size:11px;color:var(--ib-soft);letter-spacing:.08em;padding:0 14px;margin-bottom:12px}.ib-wb-nav nav{display:grid;gap:5px;overflow:auto}.ib-wb-nav-item{display:flex;align-items:center;gap:11px;min-height:43px;width:100%;text-align:left;border:0;background:none;color:var(--ib-soft);border-radius:8px;padding:9px 13px;font-size:14px;cursor:pointer;white-space:nowrap}.ib-wb-nav-item svg{flex:none}.ib-wb-nav-item:hover{background:var(--ib-hover);color:var(--ib-text)}.ib-wb-nav-item[aria-current=page]{color:var(--ib-accent-ink);background:var(--ib-accent-soft);font-weight:600}.ib-wb-nav-bottom{margin-top:auto;padding-top:24px}.ib-wb-nav-bottom small{display:block;color:var(--ib-soft);font-size:10px;padding:15px 13px 0;opacity:.75}
.ib-wb-center{grid-column:2;grid-row:2;min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden;background:var(--ib-bg)}.ib-wb-page-head{padding:23px 26px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--ib-hair);flex:none}.ib-wb-breadcrumb{display:flex;align-items:center;gap:9px;font-size:11px;color:var(--ib-soft);margin-bottom:11px}.ib-wb-breadcrumb span{opacity:.5}.ib-wb-page-head h1{font-size:23px;font-weight:650;letter-spacing:-.7px;margin:0 0 4px}.ib-wb-page-head p{font-size:12px;color:var(--ib-soft);margin:0}.ib-wb-content.ib-overlay{position:relative;inset:auto;z-index:auto;flex:1;min-height:0;overflow:auto;background:var(--ib-bg);padding:22px 26px 40px;font-size:14px}.ib-wb-content .ib-head h1{font-size:22px}.ib-wb-content .ib-head{align-items:flex-start;flex-wrap:wrap;gap:14px}.ib-wb-content .ib-head p{font-size:13px}.ib-wb-content .ib-grid{grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))}.ib-wb-content .ib-project{min-height:155px;border:1px solid var(--ib-hair);border-radius:10px;padding:18px}.ib-wb-content .ib-project:hover{border-color:var(--ib-accent-line);transform:none}.ib-wb-content .ib-project h2{font-size:16px;margin:16px 0 6px}.ib-wb-content .ib-project p{font-size:12px;padding-bottom:28px}.ib-wb-content .ib-project-foot{font-size:11px}.ib-wb-content .ib-project-head{flex-wrap:wrap;gap:8px;margin-bottom:18px}.ib-wb-content .ib-project-copy h1{font-size:17px}.ib-wb-content .ib-project-copy p{font-size:11px}.ib-wb-content .ib-project-head>[data-danger]{margin-left:auto}.ib-wb-content .ib-btn{font-size:12px;padding:0 11px;height:33px}.ib-wb-content .ib-form-grid{grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))}
.ib-wb-resize{grid-column:3;grid-row:2;cursor:col-resize;touch-action:none;z-index:9;background:var(--ib-bg);border-left:1px solid var(--ib-hair)}.ib-wb-resize:hover,.ib-wb-resize:active{background:var(--ib-accent-soft);border-color:var(--ib-accent)}.ib-wb-chat{grid-column:4;grid-row:2;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--ib-bg);container-type:inline-size}.ib-wb-chat-title{height:49px;display:flex;align-items:center;gap:8px;padding:0 17px;border-bottom:1px solid var(--ib-hair);flex:none}.ib-wb-chat-title strong{font-size:13px;font-weight:600}.ib-wb-chat-title>span:last-child{font-size:10px;color:var(--ib-soft);margin-left:auto;border:1px solid var(--ib-hair);border-radius:4px;padding:1px 5px;letter-spacing:.05em}.ib-wb-online-dot{width:6px;height:6px;border-radius:50%;background:var(--ib-accent)}.ib-wb-context{padding:10px 16px;background:var(--ib-panel);font-size:11px;display:grid;gap:3px;border-bottom:1px solid var(--ib-hair);flex:none}.ib-wb-context span{color:var(--ib-soft)}.ib-wb-context b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ib-accent-ink)}.ib-wb-conversation{flex:1;min-height:0;overflow:hidden;position:relative;--dsh-composer-card-max-width:100%;--dsh-conversation-max-width:100%}.ib-wb-conversation>div{height:100%;min-height:0}.ib-wb-conversation [class*='_headline']{font-size:19px;line-height:1.5}.ib-wb-conversation [class*='_workspaceRow']{flex-wrap:wrap}.ib-wb-conversation [class*='_root']:has(>[class*='_stack']){padding:0 16px}.ib-wb-conversation [class*='_headerLeading']{max-width:42px}.ib-wb[data-chat-hidden]{grid-template-columns:190px minmax(0,1fr)}.ib-wb[data-chat-hidden] .ib-wb-resize{display:none}
.ib-wb-resources{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:8}.ib-wb-resources:has([data-sidebar-right-open]){pointer-events:auto;background:var(--ib-bg)}.ib-wb-resources [data-sidebar-right-panel]{position:absolute!important;inset:0!important;width:100%!important;max-width:100%!important;height:100%!important;--dsh-sidebar-width:100%!important}.ib-wb-global{position:absolute;inset:0;overflow:auto;background:var(--ib-bg);z-index:7;padding-top:42px}.ib-wb-back{position:absolute;left:16px;top:6px;z-index:2}.ib-wb-overlays{position:absolute;inset:0;z-index:30;pointer-events:none}.ib-wb-overlays>*{pointer-events:auto}.ib-wb-leading{position:absolute;left:0;top:0;pointer-events:none}
.ib-wb-history{position:absolute;inset:54px 0 0;z-index:25}.ib-wb-history-dismiss{position:absolute;inset:0;background:rgba(15,23,42,.15);border:0}.ib-wb-history-panel{position:absolute;left:0;top:0;bottom:0;width:300px;display:flex;flex-direction:column;background:var(--ib-panel);border-right:1px solid var(--ib-hair);box-shadow:8px 0 30px rgba(0,0,0,.08)}.ib-wb-history-heading{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--ib-hair);flex:none}.ib-wb-history-panel>div:last-child{flex:1;min-height:0}.ib-wb-writing{max-width:850px;margin:0 auto}.ib-wb-section-title{display:flex;align-items:center;gap:10px}.ib-wb-section-title svg{color:var(--ib-accent)}.ib-wb-section-title h2{font-size:19px;margin:6px 0}.ib-wb-writing>p{font-size:13px;color:var(--ib-soft);margin:4px 0 24px}.ib-wb-writing label{display:block;font-size:12px;font-weight:600;margin-bottom:9px}.ib-wb-writing textarea{width:100%;min-height:320px;padding:15px;resize:vertical;line-height:1.8;outline:none;color:var(--ib-text)}.ib-wb-writing textarea:focus{border-color:var(--ib-accent)}.ib-wb-writing-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.ib-wb-writing-footer small{font-size:11px!important;color:var(--ib-soft)}.ib-wb-pending{max-width:460px;margin:70px auto;text-align:center}.ib-wb-pending-icon{display:grid;place-items:center;width:52px;height:52px;margin:auto;background:var(--ib-accent-soft);color:var(--ib-accent-ink);border-radius:14px}.ib-wb-pending h2{font-size:21px;margin:16px 0 8px}.ib-wb-status{font-size:11px;color:var(--ib-soft);background:var(--ib-panel);border:1px solid var(--ib-hair);padding:3px 9px;border-radius:20px}.ib-wb-pending p{font-size:13px;color:var(--ib-soft);line-height:1.8;margin:18px 0 23px}.ib-wb-alert{padding:10px 24px;background:var(--ib-panel);color:var(--ib-red);font-size:12px;flex:none}
@media(max-width:1150px){.ib-wb{grid-template-columns:164px minmax(0,1fr) 5px 330px}.ib-wb[data-chat-hidden]{grid-template-columns:164px minmax(0,1fr)}.ib-wb-nav{padding-inline:7px}.ib-wb-nav-item{font-size:12px;gap:8px;padding-inline:10px}.ib-wb-page-head{padding:18px}.ib-wb-content.ib-overlay{padding:18px}.ib-wb-dev-label{display:none}}
@media(max-width:850px){.ib-wb{grid-template-columns:58px minmax(0,1fr) 5px 320px}.ib-wb[data-chat-hidden]{grid-template-columns:58px minmax(0,1fr)}.ib-wb-nav{padding:16px 5px}.ib-wb-nav-label,.ib-wb-nav-item span,.ib-wb-nav-bottom small{display:none}.ib-wb-nav-item{justify-content:center;padding:10px 0}.ib-wb-top{gap:8px;padding-inline:12px}.ib-wb-top-divider{margin:0 2px}.ib-wb-brand{font-size:15px}.ib-wb-project-picker{max-width:25vw}.ib-wb-tool{padding:5px 7px;font-size:11px}}
@media(max-width:650px){.ib-wb{grid-template-columns:58px minmax(0,1fr)}.ib-wb-chat{position:absolute;right:0;top:54px;bottom:0;width:min(380px,calc(100vw - 58px));z-index:15;border-left:1px solid var(--ib-hair);box-shadow:-8px 0 30px rgba(0,0,0,.08)}.ib-wb-resize{display:none}.ib-wb-project-picker{display:none}.ib-wb-page-head h1{font-size:21px}}
.ib-wb-conversation [class*='_headline'] [class*='_headline']{font-size:inherit!important;line-height:inherit!important}
.ib-wb .ib-wb-chat .ib-wb-conversation [class*='_titleGroup'],.ib-wb .ib-wb-chat .ib-wb-conversation [class*='_titleGroup']>span{font-size:22px!important;line-height:1.4!important}
.ib-wb-conversation .ib-hero-avatar{width:40px;height:40px}.ib-wb-conversation .ib-hero-project{display:none}
html[data-windows-titlebar] .ib-wb-leading{display:none}
html[data-windows-titlebar] .ib-wb-chat{--ib-wb-caption:var(--dsh-windows-titlebar-height,40px)}
@media(max-width:650px){html[data-windows-titlebar] .ib-wb-chat{top:calc(54px + var(--ib-wb-caption,0px))}}
/* Readable desktop scale. Keep the viewport and window geometry native. */
.ib-wb .ib-wb-brand-mark{overflow:hidden;background:transparent;flex:none}.ib-wb-brand-mark img{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.ib-wb .ib-wb-conversation [class*='_headline']{display:none!important}
.ib-wb{font-size:18px;line-height:1.6;grid-template-columns:220px minmax(0,1fr) 5px minmax(320px,min(var(--ib-wb-chat-width,380px),45vw));--dsh-windows-sidebar-width:220px}
.ib-wb[data-chat-hidden]{grid-template-columns:220px minmax(0,1fr)}
.ib-wb .ib-wb-brand{font-size:22px}.ib-wb .ib-wb-brand-mark{width:34px;height:34px}
.ib-wb :is(.ib-wb-project-picker,.ib-wb-tool,.ib-wb-dev-label){font-size:16px}
.ib-wb .ib-wb-tool{padding:6px 12px}.ib-wb .ib-wb-project-picker{min-width:0}
.ib-wb .ib-wb-nav-label{font-size:15px}.ib-wb .ib-wb-nav-item{font-size:18px;min-height:49px;padding:11px 13px}
.ib-wb .ib-wb-nav-bottom small{font-size:14px}
.ib-wb .ib-wb-breadcrumb{font-size:15px}.ib-wb .ib-wb-page-head h1{font-size:30px;line-height:1.35}
.ib-wb .ib-wb-page-head p{font-size:16px;line-height:1.65}
.ib-wb .ib-wb-content.ib-overlay{font-size:18px;line-height:1.65;--ib-control-h:40px;--ib-action-h:38px}
.ib-wb .ib-wb-content :is(.ib-head h1,.ib-project-copy h1){font-size:24px;line-height:1.4}
.ib-wb .ib-wb-content :is(.ib-head p,.ib-project-copy p,.ib-project p,.ib-project-foot){font-size:16px;line-height:1.65}
.ib-wb .ib-wb-content .ib-project h2{font-size:22px}
.ib-wb .ib-wb-content :is(.ib-group-head h3,.ib-card-title,.sw-head h3,.ib-preview-title b,.ib-tm-title b){font-size:22px;line-height:1.5}
.ib-wb .ib-wb-content :is(.ib-lit-title){font-size:22px;line-height:1.5}
.ib-wb .ib-wb-content :is(.ib-lit-zh,.ib-lit-overview){font-size:18px;line-height:1.75}
.ib-wb .ib-wb-content :is(.ib-lit-meta,.ib-group-count,.ib-muted,.ib-chip,.ib-lit-flag,.ib-lit-overview-meta,.ib-lit-overview-time,.ib-search-citation,.ib-table-head,.ib-table-row,.ib-help,.ib-fulltext-note,.ib-lit-note,.ib-sub,small,label){font-size:16px;line-height:1.65}
.ib-wb .ib-wb-content :is(.ib-lit-empty,.ib-empty){font-size:16px;line-height:1.8;padding:24px 18px;overflow-wrap:anywhere}
.ib-wb .ib-wb-content :is(.ib-btn,.ib-act,.ib-sub-btn,.ib-lit-btn,.ib-preview-btn){font-size:16px;min-height:38px;height:auto;line-height:1.4;padding:8px 10px}
.ib-wb .ib-wb-page-head .ib-btn{font-size:16px;min-height:38px;line-height:1.4;padding:8px 12px}
.ib-wb .ib-wb-content :is(input,textarea,select){font-size:18px;line-height:1.6}
.ib-wb .ib-wb-content :is(.ib-tab,.ib-tm-tab){font-size:18px;min-height:44px}
.ib-wb .ib-wb-writing :is(p,label){font-size:17px}.ib-wb .ib-wb-writing textarea{font-size:18px}
.ib-wb .ib-wb-writing-footer small{font-size:15px!important}.ib-wb .ib-wb-section-title h2,.ib-wb .ib-wb-pending h2{font-size:26px}
.ib-wb :is(.ib-wb-pending p,.ib-wb-alert){font-size:17px;line-height:1.7}.ib-wb .ib-wb-status{font-size:15px}
.ib-wb .ib-wb-chat-title{height:54px}.ib-wb .ib-wb-chat-title strong{font-size:18px}.ib-wb .ib-wb-chat-title>span:last-child{font-size:14px}
.ib-wb .ib-wb-context{font-size:16px;line-height:1.6;padding:12px 16px}
.ib-wb .ib-wb-conversation{--dsh-content-font-size:18px;font-size:18px;line-height:1.7}
.ib-wb .ib-wb-conversation :is([contenteditable=true],[contenteditable=true] p,textarea){font-size:18px!important;line-height:1.7}
.ib-wb .ib-wb-conversation :is(button,[class*='_workspaceLabel'],[class*='_seatLabel'],[class*='_triggerLabel'],[class*='_triggerEffort']){font-size:16px}
.ib-wb .ib-wb-chat .ib-wb-conversation [class*='_titleGroup']>span{font-size:26px!important}
.ib-wb .ib-wb-content :is(.sw-cond-label,.sw-cond-value,.sw-mini-btn,.sw-step-btn,.sw-step-sub,.sw-field-label,.sw-field-input,.sw-field-select,.sw-apply-btn,.sw-evidence-quote,.sw-evidence-locator,.sw-plan-label,.sw-step-status,.sw04-step-meta,.sw04-cond-key,.sw04-cond-val,.sw04-tab,.sw04-field-label,.sw04-cond-cell,.sw04-status,.sw04-route-btn,.sw04-subtitle,.sw04-inline-note,.sw04-step-title,.sw04-plan-grid span,.sw04-mini-btn,.sw04-quality-note,.sw04-file-tag,.sw04-difficulty){font-size:16px;line-height:1.6}
.ib-wb .ib-wb-content :is(.ib-version,.ib-key,.ib-tm-sub,.ib-tm-btn,.ib-tm-chip,.ib-row,.ib-row b,.ib-dl-main b,.ib-dl-main small,.ib-dl-state,.ib-review-detail-head span,.ib-review-finding,.ib-preview-title small,.ib-preview-foot-note,.ib-preview-state,.sw-head p,.sw-select,.sw-step-id,.sw-step-preview,.sw-cond,.sw-note,.sw-analy-block,.sw-plan-row,.sw-hint,.sw-plan-empty,.sw-plan-empty b,.sw-meta-note,.sw-ev-meta,.sw-ev-tag,.sw-struct-name,.sw-struct-src,.sw-ev-act button,.sw-ev-shot-note,.sw-ev-shot-fail,.sw-review-quote,.sw04-reaction-side>small,.sw04-arrow>span,.sw04-plan-preview p,.sw04-plan-preview li,.sw04-plan-preview h4,.sw04-structure-candidate-head small){font-size:16px;line-height:1.65}
@media(max-width:1150px){.ib-wb{grid-template-columns:200px minmax(0,1fr) 5px 330px}.ib-wb[data-chat-hidden]{grid-template-columns:200px minmax(0,1fr)}.ib-wb .ib-wb-nav-item{font-size:17px;padding-inline:9px;gap:8px}.ib-wb .ib-wb-top{gap:10px}.ib-wb .ib-wb-top-divider{margin-left:4px}}
@media(max-width:850px){.ib-wb{grid-template-columns:58px minmax(0,1fr) 5px 320px}.ib-wb[data-chat-hidden]{grid-template-columns:58px minmax(0,1fr)}.ib-wb .ib-wb-nav-item{padding:11px 0}.ib-wb .ib-wb-brand{font-size:18px}.ib-wb .ib-wb-tool{font-size:15px;padding:6px 8px}.ib-wb .ib-wb-project-picker{font-size:15px}.ib-wb .ib-wb-page-head{flex-wrap:wrap}}
@media(max-width:650px){.ib-wb{grid-template-columns:58px minmax(0,1fr)}.ib-wb .ib-wb-brand-mark{width:28px;height:28px}}
.ib-project-file-home{max-width:1050px;margin:0 auto;padding:8px 4px 40px}.ib-project-file-home>p{color:var(--ib-muted,#64748b);line-height:1.8}.ib-project-file-home h2{font-size:28px}.ib-project-file-home h3{margin-top:32px;font-size:22px}.ib-project-file-actions{display:flex;gap:12px;margin:24px 0}.ib-project-file-new{padding:22px;border:1px solid var(--ib-border,#e2e8f0);border-radius:12px;background:var(--ib-card,#fff)}.ib-project-file-new label{display:block;font-size:20px;font-weight:600;margin-bottom:14px}.ib-project-file-new>div{display:flex;gap:12px;flex-wrap:wrap}.ib-project-file-new input{min-width:180px;flex:1;padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}.ib-project-file-new small{display:block;margin-top:14px;line-height:1.7;color:#64748b}.ib-project-file-recents{display:grid;gap:12px}.ib-project-file-recent{display:flex;flex-direction:column;gap:8px;text-align:left;padding:18px 22px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;font:inherit;min-width:0}.ib-project-file-recent:hover{border-color:#0d9488;background:#f0fdfa}.ib-project-file-recent span{font-size:15px;color:#64748b;overflow-wrap:anywhere}.ib-wb .ib-project-copy p{overflow-wrap:anywhere}
.ib-wb-chat-empty{padding:40px 28px;font-size:17px;line-height:1.8;color:#64748b}
/* An unloaded workbench is a full welcome page, without research navigation or chat. */
.ib-wb[data-welcome],.ib-wb[data-welcome][data-chat-hidden]{grid-template-columns:minmax(0,1fr);--dsh-windows-sidebar-width:0px}
.ib-wb[data-welcome]>.ib-wb-center{grid-column:1;grid-row:2}
.ib-wb .ib-wb-current-project{display:flex;align-items:center;gap:12px;min-width:0;max-width:45vw;font-size:17px}
.ib-wb-current-project>span{color:var(--ib-soft);white-space:nowrap;font-size:15px}
.ib-wb-current-project>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.ib-wb .ib-wb-welcome.ib-overlay{padding:clamp(36px,7vh,96px) clamp(24px,6vw,110px) 64px;background:linear-gradient(145deg,var(--ib-bg) 45%,var(--ib-panel))}
.ib-project-file-welcome{max-width:1200px;width:100%;padding:0}
.ib-project-file-welcome>h1{font-size:clamp(30px,3vw,44px);line-height:1.3;letter-spacing:-1px;margin:0 0 18px;font-weight:650}
.ib-project-file-welcome>p{font-size:18px;margin:0 0 42px;max-width:780px}
.ib-project-file-welcome .ib-project-file-entry-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px}
.ib-project-file-welcome .ib-project-file-actions{margin:0 0 24px}
.ib-project-file-welcome .ib-project-file-history h3{margin:0 0 20px;font-size:22px}
.ib-project-file-welcome .ib-project-file-new>div{flex-direction:column}
.ib-project-file-welcome .ib-project-file-new input{min-width:0;width:100%}
.ib-project-file-welcome .ib-project-file-new button{align-self:flex-start}
.ib-project-file-welcome .ib-project-file-recent span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
@media(max-width:850px){.ib-project-file-welcome .ib-project-file-entry-grid{grid-template-columns:minmax(0,1fr);gap:36px}.ib-wb .ib-wb-current-project{gap:6px;max-width:35vw}.ib-wb-current-project>span{display:none}}
@media(max-width:650px){.ib-wb .ib-wb-current-project{font-size:15px;max-width:30vw}.ib-wb[data-welcome]>.ib-wb-top{padding-inline:18px}.ib-project-file-welcome>p{font-size:16px}}
/* Dock both the project/model selectors and the editor at the bottom of the chat pane. */
.ib-wb .ib-wb-conversation [class*='_scrollBody']{justify-content:flex-start!important}
.ib-wb .ib-wb-conversation [class*='_composerSeat']{margin-top:auto}
.ib-wb .ib-wb-conversation [class*='_composerHero']{padding-bottom:16px}
/* Base the literature columns on usable workspace width, including chat/sidebar changes. */
.ib-wb-project-page{container-name:ib-literature;container-type:inline-size}
.ib-wb .ib-wb-business:has(.ib-wb-project-page:is([data-workspace=literature],[data-workspace=characterization])){padding-bottom:0}
.ib-wb-project-page[data-workspace=literature]>.ib-memory-drawer{display:none}
.ib-wb .ib-wb-project-page .ib-lit{grid-template-columns:minmax(0,1fr);grid-template-rows:max-content minmax(min-content,1fr);align-items:stretch;align-content:stretch;gap:28px;min-height:100%}
.ib-wb .ib-lit-group{align-content:start}
@container ib-literature (min-width:1000px){
 .ib-wb .ib-wb-project-page .ib-lit{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(min-content,1fr);gap:28px}
 .ib-wb .ib-lit-group+.ib-lit-group{border-left:1px solid var(--ib-hair);padding-left:28px}
}
.ib-wb .ib-literature-drop{position:relative;min-height:200px}
.ib-wb .ib-literature-drop[data-dragging=true]{outline:2px dashed var(--ib-accent);outline-offset:-2px;background:var(--ib-row-alt)}
.ib-literature-drop-label{position:sticky;top:0;z-index:2;padding:12px 14px;color:var(--ib-accent-ink);background:var(--ib-accent-soft);border-radius:6px;font-size:15px;pointer-events:none}
.ib-wb-chat{position:relative}.ib-wb-chat[data-dragging=true]::after{content:'松开以添加到对话框';position:absolute;inset:8px;z-index:20;display:grid;place-items:center;border:2px dashed var(--ib-accent);border-radius:8px;background:var(--ib-accent-soft);color:var(--ib-accent-ink);font-size:18px;pointer-events:none}
/* Literature workbench redesign: catalog + detail. */
.ib-wb .ib-wb-project-page .ib-lit.ib-lit-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,420px);grid-template-rows:1fr;gap:0;align-items:start;min-height:100%}
.ib-tab-panel:has(.ib-lit-workbench){overflow:hidden}.ib-lit-catalog{min-width:0;position:relative;max-height:calc(100vh - 300px);overflow-y:auto;overflow-x:hidden;padding-right:4px;scrollbar-gutter:stable}
.ib-wb:has(.ib-reader) .ib-lit-toolbar,.ib-wb:has(.ib-reader) .ib-lit-tabs,.ib-wb:has(.ib-reader) .ib-lit-folders{display:none!important}
.ib-lit-workbench{position:relative}
.ib-lit-head-actions{position:absolute;left:250px;top:44px;z-index:3;display:flex;align-items:center;gap:10px}
.ib-wb-page-head{position:relative}
.ib-lit-head-actions .ib-lit-toolbar{margin:0}
.ib-lit-drop-overlay{position:absolute;inset:0;z-index:30;display:grid;place-items:center;border:2px dashed var(--ib-accent);border-radius:12px;background:rgba(227,242,236,.92);color:var(--ib-accent-ink);font:600 18px/1.4 var(--ib-font,system-ui);pointer-events:none}
.ib-lit-toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:flex-end;align-items:center;gap:10px;background:var(--ib-bg);height:56px;padding:0;box-sizing:border-box}.ib-lit-toolbar .ib-act{height:38px;padding:0 14px;font-size:15px}.ib-lit-head-slot{position:absolute;left:250px;top:44px;z-index:3;display:flex;align-items:center;justify-content:flex-start}.ib-lit-head-slot .ib-lit-toolbar{position:static;height:auto;padding:0;background:transparent;justify-content:flex-start}.ib-lit-head-slot .ib-lit-toolbar .ib-act{flex:none;height:40px;padding:0 16px;white-space:nowrap;border:1px solid var(--ib-accent);border-radius:8px;background:transparent;color:var(--ib-accent-ink);font:600 15px/1 var(--ib-font,system-ui);display:inline-flex;align-items:center;gap:7px;box-shadow:none}.ib-lit-head-slot .ib-lit-toolbar .ib-act:hover{background:var(--ib-accent-soft)}.ib-lit-head-slot .ib-lit-toolbar .ib-act-primary{background:var(--ib-accent);border-color:var(--ib-accent);color:#fff}.ib-lit-head-slot .ib-lit-toolbar .ib-act-primary:hover{background:var(--ib-accent-ink)}
@media(max-width:1400px){.ib-lit-head-slot .ib-lit-toolbar .ib-act{height:34px;padding:0 10px;font-size:13px;gap:5px}}.ib-lit-workbench[data-toolbar-in-header] .ib-lit-tabs{top:0}.ib-lit-workbench[data-toolbar-in-header] .ib-lit-folders{top:48px}
.ib-lit-head-actions .ib-lit-toolbar .ib-act{flex:none;height:40px;padding:0 16px;white-space:nowrap;border:1px solid var(--ib-accent);border-radius:8px;background:transparent;color:var(--ib-accent-ink);font:600 15px/1 var(--ib-font,system-ui);display:inline-flex;align-items:center;gap:7px;box-shadow:none}
.ib-lit-head-actions .ib-lit-toolbar .ib-act:hover{background:var(--ib-accent-soft)}
.ib-lit-head-actions .ib-lit-toolbar .ib-act-primary{background:var(--ib-accent);border-color:var(--ib-accent);color:#fff}
.ib-lit-head-actions .ib-lit-toolbar .ib-act-primary:hover{background:var(--ib-accent-ink)}
.ib-lit-upload-wrap{position:relative;display:inline-flex}
.ib-lit-upload-menu{position:absolute;right:0;top:48px;z-index:40;min-width:168px;padding:6px;border:1px solid var(--ib-line);border-radius:9px;background:var(--ib-panel);box-shadow:0 12px 28px rgba(15,23,42,.18)}
.ib-lit-upload-menu button{display:block;width:100%;border:0;border-radius:6px;background:transparent;text-align:left;padding:10px 12px;color:var(--ib-text);font:500 14px/1.2 var(--ib-font,system-ui);cursor:pointer}
.ib-lit-upload-menu button:hover{background:var(--ib-accent-soft);color:var(--ib-accent-ink)}
.ib-lit-link-modal{position:fixed;inset:0;z-index:9500;display:grid;place-items:center;background:rgba(20,30,28,.3);backdrop-filter:blur(2px);padding:24px}
.ib-lit-link-dialog{width:min(860px,92vw);background:#fbfcfb;border:1px solid #e4eae6;border-radius:18px;padding:26px 30px 0;box-shadow:0 30px 80px rgba(15,40,32,.24);color:#1d2a25}
.ib-lit-link-head{display:flex;align-items:flex-start;gap:16px;padding-bottom:18px}
.ib-lit-link-icon{flex:none;width:54px;height:54px;border-radius:14px;background:#e6f2ec;color:#0f766e;display:grid;place-items:center}
.ib-lit-link-icon svg{width:28px;height:28px}
.ib-lit-link-head-copy{min-width:0;flex:1}
.ib-lit-link-head-copy h2{margin:0;font:600 30px/1.2 var(--ib-serif,Georgia,serif);letter-spacing:.01em}
.ib-lit-link-head-copy p{margin:6px 0 0;font:400 16px/1.4 var(--ib-font,system-ui);color:#66736d}
.ib-lit-link-close{flex:none;border:0;background:transparent;color:#5f6d66;font:300 32px/1 var(--ib-font,system-ui);cursor:pointer;padding:0 2px}
.ib-lit-link-form{display:flex;flex-direction:column}
.ib-lit-link-label{font:600 18px/1.2 var(--ib-font,system-ui);margin:4px 0 10px}
.ib-lit-link-field{display:flex;align-items:center;height:56px;border:1.5px solid #0f766e;border-radius:10px;background:#fff;padding:0 8px 0 18px;box-sizing:border-box}
.ib-lit-link-field input{flex:1;min-width:0;height:100%;border:0!important;outline:none!important;box-shadow:none!important;background:transparent;color:#1d2a25;font:400 17px/1 var(--ib-font,system-ui);padding:0;box-sizing:border-box;appearance:none}
.ib-lit-link-field input:focus,.ib-lit-link-field input:focus-visible{outline:none!important;box-shadow:none!important;border:0!important}
.ib-lit-link-field input::placeholder{color:#8b9690}
.ib-lit-link-divider{width:1px;height:28px;background:#d9e1dc;margin:0 12px}
.ib-lit-link-paste{display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;color:#33443d;font:500 16px/1 var(--ib-font,system-ui);cursor:pointer;padding:6px 10px;border-radius:7px}
.ib-lit-link-paste:hover{background:#eef4f0}
.ib-lit-link-hint{margin:10px 0 2px;color:#8a9690;font:400 14px/1.5 var(--ib-font,system-ui)}
.ib-lit-link-error{margin:8px 0 0;color:#b42318;font:400 14px/1.4 var(--ib-font,system-ui)}
.ib-lit-link-actions{display:flex;justify-content:flex-end;gap:12px;border-top:1px solid #e5ebe7;margin-top:26px;padding:18px 0 22px}
.ib-lit-link-cancel{height:48px;min-width:112px;border:1px solid #d8e1db;border-radius:9px;background:#fff;color:#1d2a25;font:500 17px/1 var(--ib-font,system-ui);cursor:pointer}
.ib-lit-link-submit{height:48px;min-width:176px;border:0;border-radius:9px;background:#0f766e;color:#fff;font:600 17px/1 var(--ib-font,system-ui);cursor:pointer}
.ib-lit-link-submit:disabled{opacity:1;background:#0f766e;color:#fff;cursor:not-allowed}
.ib-lit-toolbar .ib-act-primary{background:var(--ib-accent);border-color:var(--ib-accent);color:#fff}
.ib-lit-tabs{position:sticky;top:56px;z-index:19;display:flex;justify-content:flex-start;align-items:center;gap:56px;border-bottom:1px solid var(--ib-line);height:48px;margin:0;background:var(--ib-bg);box-sizing:border-box}
.ib-lit-tab{position:relative;border:0;background:none;padding:6px 2px 14px;color:var(--ib-muted);font:600 20px/1.2 var(--ib-serif,Georgia,serif);cursor:pointer;display:flex;align-items:baseline;gap:10px}
.ib-lit-tab span{font:500 14px/1 var(--ib-font,system-ui);color:var(--ib-muted)}
.ib-lit-tab[data-active=true]{color:var(--ib-text)}
.ib-lit-tab[data-active=true]::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:3px;background:var(--ib-accent);border-radius:3px 3px 0 0}
.ib-lit-folders{position:sticky;top:104px;z-index:18;display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:44px;margin:0 0 10px;padding:0;background:var(--ib-bg);box-sizing:border-box}
.ib-lit-folder{border:1px solid transparent;background:transparent;border-radius:999px;padding:7px 14px;font:500 14px/1 var(--ib-font,system-ui);color:var(--ib-text);cursor:pointer}
.ib-lit-folder span{margin-left:8px;color:var(--ib-muted)}
.ib-lit-folder[data-active=true]{background:var(--ib-accent-soft);color:var(--ib-accent-ink)}
.ib-lit-folder[data-drop-folder=true]{outline:2px dashed var(--ib-accent);outline-offset:2px}
.ib-lit-folder-add{font-size:18px;line-height:1;padding:4px 11px}
.ib-lit-folder-input{width:160px;height:34px;border:1px solid var(--ib-accent);border-radius:999px;padding:0 12px;background:var(--ib-panel);color:var(--ib-text);font:400 14px/1 var(--ib-font,system-ui);outline:none}
.ib-lit-folder-menu{position:fixed;z-index:9000;min-width:132px;padding:6px;border:1px solid var(--ib-line);border-radius:8px;background:var(--ib-panel);box-shadow:0 10px 24px rgba(15,23,42,.16)}
.ib-lit-folder-menu button{width:100%;border:0;background:transparent;text-align:left;padding:9px 12px;border-radius:6px;color:#b42318;font:500 14px/1 var(--ib-font,system-ui);cursor:pointer}
.ib-lit-folder-menu button:hover{background:rgba(180,35,24,.08)}
.ib-lit-folder-editor{display:flex;align-items:center;gap:8px;margin:-6px 0 14px}
.ib-lit-folder-editor input{height:34px;min-width:220px;border:1px solid var(--ib-accent);border-radius:7px;padding:0 10px;background:var(--ib-panel);color:var(--ib-text);font:400 14px/1 var(--ib-font,system-ui)}
.ib-lit-card[data-dragging-entry=true]{opacity:.45}
.ib-lit-card[data-drop-position=before]{box-shadow:inset 0 3px 0 var(--ib-accent)}
.ib-lit-card[data-drop-position=after]{box-shadow:inset 0 -3px 0 var(--ib-accent)}
.ib-lit-card-detail{background:var(--ib-accent-soft);border-color:var(--ib-accent);box-shadow:none}
.ib-lit-cards{display:flex;flex-direction:column;gap:14px}
.ib-lit-card{display:flex;align-items:center;gap:22px;width:100%;min-width:0;min-height:118px;padding:12px 18px;border:1px solid var(--ib-line);border-radius:10px;background:var(--ib-panel);cursor:pointer;overflow:hidden;box-sizing:border-box;transition:background .15s,border-color .15s}
.ib-lit-card:hover{border-color:var(--ib-accent)}
.ib-lit-card[data-selected=true]{background:var(--ib-accent-soft);border-color:var(--ib-accent)}
.ib-paper-cover{flex:none;width:82px;height:100px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#fff;background:linear-gradient(160deg,#536a7c,#354958);box-sizing:border-box;text-align:center;overflow:hidden}
.ib-paper-cover b{font:700 22px/1 var(--ib-serif,Georgia,serif);letter-spacing:.01em}.ib-paper-cover small{font:600 8px/1 var(--ib-font,system-ui);letter-spacing:.12em;color:#dbe6ea}.ib-paper-cover-lg{width:96px;height:116px}
.ib-lit-card-copy{min-width:0;flex:1 1 0;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.ib-lit-card .ib-lit-title{font:600 20px/1.35 var(--ib-serif,Georgia,serif);color:var(--ib-text);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ib-lit-card-cite{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden}.ib-lit-cite-text{min-width:0;font:italic 400 14px/1.35 var(--ib-font,system-ui);color:#6a7780;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-lit-field-pill{flex:none;padding:4px 10px;border-radius:999px;background:#eef2f0;color:#52645d;font:500 12px/1 var(--ib-font,system-ui)}
.ib-lit-card-more{color:var(--ib-muted);font-size:22px;line-height:1;flex:none}
.ib-lit-metrics[data-missing=true]{cursor:pointer}.ib-lit-metrics[data-missing=true]:hover{opacity:.82}.ib-lit-metrics{flex:none;display:flex;align-items:center;gap:6px}.ib-lit-metric-box{width:62px;height:72px;border-radius:10px;background:#f3f6f5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:4px;box-sizing:border-box}.ib-lit-metric-box span{font:500 10px/1.2 var(--ib-font,system-ui);color:#78867f;white-space:nowrap}.ib-lit-metric-box b{font:700 18px/1 var(--ib-serif,Georgia,serif);color:#4b5b54}.ib-lit-metric-box[data-tone=if]{background:#eaf5ef}.ib-lit-metric-box[data-tone=if] b{color:#0f766e}.ib-lit-metric-box[data-tone=cas]{background:#eef4fb}.ib-lit-metric-box[data-tone=cas] b{color:#2563eb}.ib-lit-metric-box[data-tone=top]{background:#f3f4f6}.ib-lit-metric-box[data-tone=top] b{color:#6b7280;font-size:14px}
.ib-lit-card-metrics b{font:600 13px/1.2 var(--ib-font,system-ui);color:#0f6b5c}
.ib-lit-card-metrics span{white-space:nowrap}
.ib-lit-card-metrics small{max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.ib-lit-metrics-loading,.ib-lit-metrics-empty{font-size:10px;color:#9aa6b2}
.ib-lit-card-loading{cursor:default;background:var(--ib-row-alt);border-style:dashed;opacity:.9}
.ib-lit-loading-spinner{flex:none;width:82px;height:100px;border-radius:7px;display:grid;place-items:center;background:var(--ib-panel2);color:var(--ib-muted)}
.ib-lit-loading-spinner svg{width:22px;height:22px}
.ib-lit-search-list{display:flex;flex-direction:column;gap:12px}
.ib-lit-search-card{min-height:86px}
.ib-lit-detail{position:sticky;top:4px;min-width:0;border-left:1px solid var(--ib-hair);padding-left:30px;max-height:calc(100vh - 300px);overflow-y:auto;scrollbar-width:none}.ib-lit-detail::-webkit-scrollbar{display:none}
.ib-lit-detail-empty{display:grid;place-items:center;min-height:260px;color:var(--ib-muted);font-size:15px}
.ib-lit-detail-head h2{font:600 28px/1.2 var(--ib-serif,Georgia,serif);margin:0 0 22px}
.ib-lit-detail-lead{display:flex;align-items:flex-start;gap:18px;margin-bottom:22px}
.ib-lit-detail-title h3{font:600 22px/1.4 var(--ib-serif,Georgia,serif);margin:0 0 10px}
.ib-lit-detail-cite{display:flex;align-items:center;gap:10px;color:var(--ib-muted);font:400 14px/1.3 var(--ib-font,system-ui);font-style:italic}
.ib-lit-detail-cite a{color:var(--ib-accent);text-decoration:none;font-size:18px}
.ib-lit-detail h4{font:600 17px/1.3 var(--ib-serif,Georgia,serif);margin:0 0 8px}
.ib-lit-detail-intro p{font:400 14px/1.7 var(--ib-font,system-ui);color:var(--ib-text);margin:0 0 22px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.ib-lit-detail-section{border-top:1px solid var(--ib-hair);padding:16px 0 4px;margin-top:8px}
.ib-lit-detail-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.ib-lit-mini-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 13px;border:1px solid #d9e2dd;border-radius:7px;background:#fff;color:#263a33;font:500 13px/1 var(--ib-font,system-ui);cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.ib-lit-mini-btn:hover{background:#f3f7f5;border-color:#b9cec5;color:#0f6b5c}.ib-lit-detail-section-head .ib-lit-mini-btn{color:#0f6b5c;border-color:#cfe0d9}
.ib-lit-mini-btn:disabled{opacity:.45;cursor:default}
.ib-lit-file-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--ib-hair)}
.ib-lit-file-row>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.ib-lit-file-row b{font:600 14px/1.2 var(--ib-font,system-ui)}
.ib-lit-file-row small{font:400 12px/1.2 var(--ib-font,system-ui);color:var(--ib-muted)}
.ib-lit-file-icon{width:22px;text-align:center;color:var(--ib-accent)}
.ib-lit-dot{width:7px;height:7px;border-radius:50%;background:var(--ib-muted);flex:none}
.ib-lit-dot[data-ready=true]{background:var(--ib-accent)}
.ib-lit-detail-actions{display:flex;flex-direction:column;gap:10px;margin-top:24px}
.ib-lit-primary,.ib-lit-secondary{display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border-radius:9px;font:600 17px/1 var(--ib-font,system-ui);cursor:pointer}
.ib-lit-primary{border:1px solid var(--ib-accent);background:var(--ib-accent);color:#fff}
.ib-lit-secondary{border:1px solid var(--ib-line);background:#fff;color:var(--ib-text)}
.ib-lit-secondary[data-done=false]{background:#f1f4f2;border-color:#e1e7e3;color:#8a9690}
.ib-lit-secondary[data-done=true]{background:#fff;border-color:#cfdad4;color:#1d2a25}
.ib-lit-secondary[data-done=false]:hover{background:#e9efec;border-color:#cbd8d2;color:#5f6d66}
.ib-lit-primary svg,.ib-lit-secondary svg{width:20px;height:20px}
.ib-lit-secondary:disabled{opacity:.5;cursor:default}
.ib-lit-primary:disabled{background:#e5e9e7;border-color:#d7dedb;color:#8a9690;cursor:not-allowed;opacity:1}
@container ib-literature (max-width:900px){.ib-wb .ib-wb-project-page .ib-lit.ib-lit-workbench{grid-template-columns:minmax(0,1fr);gap:24px}.ib-lit-detail{position:static;border-left:0;border-top:1px solid var(--ib-hair);padding:24px 0 0;max-height:none}.ib-wb:not([data-chat-hidden]) .ib-lit-detail{display:none}}
`;
