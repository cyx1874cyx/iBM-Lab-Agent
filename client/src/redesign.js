/**
 * dsh-lab-agent: 视觉改版样式层。
 *
 * 单独成模块、并且**追加在 styles.js 的 themeCss 之后**，原因有两个：
 *   1. 基础 CSS（styles.js 数组）是深色科研风、字号偏小（9–13px），
 *      themeCss 又把 `--ib-*` 变量接到 DSH 主题 token 上。改版需要覆盖的
 *      正是 `themeCss` 自己写的那几条规则（`.ib-btn` 13px、`.ib-tab` 内边距…），
 *      所以必须在它之后加载。
 *   2. 改版规则集中在一个文件里，便于逐条对照需求文档复核与回滚。
 *
 * 设计口径（需求 §8）：白色内容区、浅灰侧栏/顶栏、深灰正文；青绿为主强调色，
 * 蓝色只用于「已完成 PPT」按钮；减少阴影/边框/重复容器；标签页用下划线表示选中；
 * 条目悬停淡灰背景；控件尺寸、圆角、图标、间距统一。
 */
export const redesignCss = `
:root,.ib-overlay,body.ib-research-chat{
  /* 强调色：青绿（主）+ 蓝（已完成 PPT）。--ib-green 是历史别名，一并指向青绿，
     这样旧规则里的 var(--ib-green) 也自动变成新版强调色。 */
  --ib-accent:#0f9488;--ib-green:#0f9488;--ib-accent-ink:#0a6a61;--ib-accent-soft:#e2f4f1;--ib-accent-line:rgba(15,148,136,.28);
  --ib-blue:#2563eb;--ib-blue-soft:#e8effd;--ib-blue-line:rgba(37,99,235,.28);
  --ib-hover:rgba(15,23,42,.045);--ib-hair:rgba(15,23,42,.09);--ib-soft:#4b5563;
  --ib-radius:10px;--ib-control-h:36px;--ib-action-h:34px;
}
@media(prefers-color-scheme:dark){:root,.ib-overlay,body.ib-research-chat{
  --ib-accent:#2ec9b6;--ib-green:#2ec9b6;--ib-accent-ink:#8fe8db;--ib-accent-soft:rgba(46,201,182,.16);--ib-accent-line:rgba(46,201,182,.38);
  --ib-blue:#5b8cf7;--ib-blue-soft:rgba(91,140,247,.18);--ib-blue-line:rgba(91,140,247,.4);
  --ib-hover:rgba(255,255,255,.05);--ib-hair:rgba(255,255,255,.12);--ib-soft:var(--ib-muted);
}}
/* ── 内容区：白底、浅灰顶栏 ─────────────────────────────────────────────── */
.ib-overlay{background:var(--ib-bg)}
.ib-overlay .ib-top{height:56px;gap:14px;padding:0 22px;background:var(--ib-panel);border-bottom:1px solid var(--ib-hair);backdrop-filter:none}
.ib-overlay .ib-crumb{font-size:14px;color:var(--ib-soft)}
.ib-overlay .ib-main{max-width:1180px;padding:26px 22px 64px}
/* ── 文字层级（需求 §6：整体字号放大）──────────────────────────────────── */
.ib-overlay{font-size:15px;line-height:1.6}
.ib-overlay .ib-head h1{font-size:26px}
.ib-overlay .ib-head p{font-size:15px;color:var(--ib-soft)}
.ib-overlay .ib-kicker{display:none}
.ib-overlay .ib-project-copy h1{font-size:22px;font-weight:600}
.ib-overlay .ib-project-copy p{font-size:14px;color:var(--ib-soft)}
.ib-overlay .ib-empty{font-size:15px;color:var(--ib-soft);border:0;background:none;padding:18px 2px;text-align:left}
.ib-overlay .ib-row{font-size:14.5px}
.ib-overlay small,.ib-overlay time,.ib-overlay .ib-muted{font-size:14px;color:var(--ib-soft)}
/* ── 减少容器：卡片/列表一律去框去影 ─────────────────────────────────────── */
.ib-overlay :is(.ib-card,.ib-board,.ib-lit-col,.ib-tm-card,.ib-project,.ib-search-results,.ib-lit-overview,.ib-review-detail,.ib-fulltext,.ib-capture-hint,.ib-table,.ib-table-head,.ib-table-row,.ib-rows .ib-row,.sw-sec,.ib-section-row,.ib-tm-wrap){
  background:var(--ib-bg);border-color:transparent;box-shadow:none;border-radius:0
}
.ib-overlay :is(.ib-card,.ib-board,.ib-lit-col,.ib-tm-card,.ib-lit-overview,.ib-review-detail,.ib-fulltext,.ib-capture-hint,.sw-sec){padding:14px 2px}
.ib-overlay .ib-card-head{margin-bottom:10px}
.ib-overlay .ib-card-title{font-size:16px;font-weight:600}
.ib-overlay .ib-chip{border-radius:6px;font-size:13px;padding:2px 8px;background:var(--ib-panel)}
/* ── 控件统一：36px 高、10px 圆角、14px 字 ───────────────────────────────── */
.ib-overlay .ib-btn{height:var(--ib-control-h);padding:0 14px;border-radius:var(--ib-radius);border:1px solid var(--ib-hair);background:var(--ib-bg);color:var(--ib-text);font-size:14px;font-weight:500;box-shadow:none;display:inline-flex;align-items:center;gap:7px}
.ib-overlay .ib-btn:hover:enabled{border-color:var(--ib-accent-line);background:var(--ib-hover)}
.ib-overlay .ib-btn[data-primary=true]{background:var(--ib-accent);border-color:transparent;color:#fff}
.ib-overlay .ib-btn[data-primary=true]:hover:enabled{background:var(--ib-accent-ink);color:#fff}
.ib-overlay .ib-btn[data-danger=true]{color:#b42318;border-color:var(--ib-hair);background:var(--ib-bg)}
.ib-overlay input,.ib-overlay textarea,.ib-overlay select{font-size:14.5px;border-radius:var(--ib-radius);border:1px solid var(--ib-hair);background:var(--ib-bg)}
/* ── 单行标签页：下划线选中（需求 §3.1/§8）──────────────────────────────── */
.ib-overlay .ib-tabs{display:flex;align-items:center;gap:26px;margin:0 0 18px;padding:0;border-bottom:1px solid var(--ib-hair);grid-template-columns:none}
.ib-overlay .ib-tab{position:relative;display:inline-flex;align-items:center;height:44px;padding:0;border:0;border-radius:0;background:none;color:var(--ib-soft);font-size:16px;font-weight:600;box-shadow:none;text-align:left}
.ib-overlay .ib-tab:hover:enabled{background:none;color:var(--ib-text)}
.ib-overlay .ib-tab[data-active=true]{color:var(--ib-accent-ink);background:none;box-shadow:none}
.ib-overlay .ib-tab[data-active=true]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--ib-accent);border-radius:2px}
.ib-overlay .ib-tab span{display:none}
.ib-overlay .ib-tab-refresh{margin-left:auto;height:32px;font-size:13.5px;color:var(--ib-soft)}
.ib-overlay .ib-tabs+.ib-tab-panel{margin-top:2px}
.ib-overlay .ib-tm-tabs{display:flex;align-items:center;gap:22px;border-bottom:1px solid var(--ib-hair);margin:0 0 16px;padding:0}
.ib-overlay .ib-tm-tab{position:relative;height:42px;padding:0;border:0;border-radius:0;background:none;color:var(--ib-soft);font-size:15.5px;font-weight:600;box-shadow:none}
.ib-overlay .ib-tm-tab[data-active=true]{color:var(--ib-accent-ink);background:none;box-shadow:none}
.ib-overlay .ib-tm-tab[data-active=true]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--ib-accent);border-radius:2px}
/* ── 分组标题与条目列表（需求 §3.1）────────────────────────────────────── */
.ib-overlay .ib-lit{display:grid;grid-template-columns:minmax(0,1fr);gap:26px}
.ib-lit-group{display:grid;gap:2px;min-width:0;container-type:inline-size}
.ib-overlay .ib-group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding-bottom:8px;border-bottom:1px solid var(--ib-hair)}
.ib-overlay .ib-group-head h3{margin:0;font-size:17px;font-weight:600;color:var(--ib-text)}
.ib-overlay .ib-group-count{font-size:14px;color:var(--ib-soft)}
.ib-overlay .ib-lit-list{display:grid;gap:0;margin:0}
.ib-overlay .ib-lit-item{display:grid;gap:8px;padding:16px 2px;border-bottom:1px solid var(--ib-hair);border-radius:0;background:none}
.ib-overlay .ib-lit-item:last-child{border-bottom:0}
.ib-overlay .ib-lit-item:hover{background:var(--ib-hover)}
/* 宽面板左标题、右操作；窄容器将操作移到标题下方，保留正文可读宽度。 */
.ib-overlay .ib-lit-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 16px;padding:0;border:0;background:none;border-radius:0}
.ib-overlay .ib-lit-main{flex:1 1 320px;min-width:0;display:grid;gap:5px}
.ib-overlay .ib-lit-title{display:block;font-size:18px;font-weight:600;line-height:1.42;color:var(--ib-text);white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
.ib-overlay .ib-citation i{font-style:italic;font-weight:700}
.ib-overlay .ib-lit-zh{font-size:16px;font-weight:400;line-height:1.55;color:var(--ib-soft);white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
.ib-overlay .ib-lit-meta{font-size:14.5px;line-height:1.5;color:var(--ib-soft);white-space:normal;overflow-wrap:anywhere}
.ib-overlay .ib-lit-acts{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;max-width:560px}
.ib-overlay .ib-lit-acts.ib-reading-acts{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;width:352px;max-width:100%;min-width:0;align-self:start}
.ib-overlay .ib-reading-act-row{display:grid;align-items:center;gap:8px;min-width:0}
.ib-overlay .ib-reading-act-row[data-row=files]{grid-template-columns:32px 32px 84px minmax(0,1fr)}
.ib-overlay .ib-reading-act-row[data-row=artifacts]{grid-template-columns:repeat(3,minmax(0,1fr)) 64px}
.ib-overlay .ib-reading-act-row :is(.ib-act,select){width:100%;min-width:0;box-sizing:border-box;white-space:nowrap}
.ib-overlay .ib-reading-act-row select{height:var(--ib-action-h);padding:0 6px;text-overflow:ellipsis;overflow:hidden;color:var(--ib-text)}
.ib-overlay .ib-lit-flag{display:inline-block;margin-top:6px;font-size:13px;color:var(--ib-accent-ink);background:var(--ib-accent-soft);border-radius:6px;padding:2px 8px}
.ib-overlay .ib-lit-overview{margin-top:2px;font-size:14.5px;line-height:1.75;color:var(--ib-text);white-space:pre-wrap;border-left:2px solid var(--ib-accent-line);padding:8px 0 8px 12px}
.ib-overlay .ib-lit-overview b{display:block;font-size:14.5px;color:var(--ib-soft);margin-bottom:4px;font-weight:600}
.ib-overlay .ib-lit-overview-meta,.ib-overlay .ib-lit-overview-time{display:block;font-size:13.5px;color:var(--ib-soft)}
/* ── 操作按钮：用填充色表达完成状态（需求 §5.1）────────────────────────── */
/* 固定宽度并居中，条目按钮按列对齐。 */
.ib-overlay .ib-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:84px;height:var(--ib-action-h);padding:0 11px;border-radius:9px;border:1px solid var(--ib-hair);background:var(--ib-bg);color:var(--ib-text);font-size:14px;font-weight:600;line-height:1;cursor:pointer;box-shadow:none}
.ib-overlay .ib-act:hover:enabled{background:var(--ib-hover);border-color:var(--ib-accent-line)}
.ib-overlay .ib-act:disabled{cursor:default;opacity:.6}
.ib-overlay .ib-act[data-kind=accent]{color:var(--ib-accent-ink);background:var(--ib-accent-soft);border-color:var(--ib-accent-line)}
.ib-overlay .ib-act[data-kind=accent]:hover:enabled{background:var(--ib-accent-soft);border-color:var(--ib-accent)}
.ib-overlay .ib-act[data-done=true][data-kind=reading]{background:var(--ib-accent);border-color:transparent;color:#fff}
.ib-overlay .ib-act[data-done=true][data-kind=reading]:hover:enabled{background:var(--ib-accent-ink);border-color:transparent;color:#fff}
.ib-overlay .ib-act[data-done=true][data-kind=ppt]{background:var(--ib-blue);border-color:transparent;color:#fff}
.ib-overlay .ib-act[data-done=true][data-kind=ppt]:hover:enabled{background:#1d4ed8;border-color:transparent;color:#fff}
.ib-overlay .ib-reading-acts .ib-act[data-done=true]{background:var(--ib-accent);border-color:transparent;color:#fff}
.ib-overlay .ib-reading-acts .ib-act[data-done=true]:hover:enabled{background:var(--ib-accent-ink);border-color:transparent;color:#fff}
.ib-overlay .ib-reading-acts .ib-act[data-done=false]:hover:enabled{background:var(--ib-hover);border-color:var(--ib-soft)}
.ib-overlay .ib-act[data-busy=true]{color:var(--ib-soft);background:var(--ib-panel);border-color:var(--ib-hair)}
.ib-spin{animation:ib-spin 900ms linear infinite}
@keyframes ib-spin{to{transform:rotate(360deg)}}
/* 次级操作：PDF / SI */
.ib-overlay .ib-sub-btn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--ib-hair);background:var(--ib-bg);color:var(--ib-soft);font-size:13.5px;font-weight:500;cursor:pointer}
.ib-overlay .ib-sub-btn:hover:enabled{background:var(--ib-hover);color:var(--ib-text);border-color:var(--ib-accent-line)}
.ib-overlay .ib-sub-btn[data-ready=true]{color:var(--ib-accent-ink);background:var(--ib-accent-soft);border-color:var(--ib-accent-line)}
.ib-overlay .ib-sub-btn[data-ready=false]{opacity:.95}
.ib-overlay .ib-sub-btn[data-opening=true]{cursor:progress}
/* 删除这类破坏性操作：平铺在条目右侧（不再收进下拉菜单——弹层会被滚动容器裁切）。 */
.ib-overlay .ib-act-danger{color:#b42318;border-color:var(--ib-hair);background:var(--ib-bg)}
.ib-overlay .ib-act-danger:hover:enabled{background:#fef3f2;border-color:#fda29b;color:#912018}
/* ── 会话头部课题入口：图标 + 名称 + 下拉箭头（需求 §2.1/§2.2）──────────── */
.ib-project-entry{position:relative;display:inline-flex;align-items:center;gap:2px;height:var(--ib-control-h)}
.ib-overlay .ib-research-badge{display:inline-flex;align-items:center;gap:8px;height:var(--ib-control-h);max-width:260px;padding:0 10px;border:1px solid var(--ib-accent-line);border-radius:var(--ib-radius);background:var(--ib-accent-soft);color:var(--ib-accent-ink);box-shadow:none;cursor:pointer;text-align:left}
.ib-overlay .ib-research-badge:hover{background:var(--ib-accent-soft);border-color:var(--ib-accent)}
.ib-project-entry .ib-badge-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15.5px;font-weight:600;color:var(--ib-accent-ink)}
.ib-project-entry .ib-badge-caret{display:inline-grid;place-items:center;width:14px;height:16px;padding:0;border:0;background:none;color:var(--ib-accent-ink);font-size:11px;line-height:1;pointer-events:none}
/* ── 检索结果条目（展开后的去重文献）────────────────────────────────────── */
.ib-overlay .ib-search-paper{padding:12px 2px;border-top:1px solid var(--ib-hair)}
.ib-overlay .ib-search-citation{font-size:14px;line-height:1.6;color:var(--ib-soft)}
.ib-overlay .ib-search-citation i{font-style:italic;font-weight:700;color:var(--ib-text)}
.ib-overlay .ib-search-paper small{display:block;margin-top:4px;font-size:15px;line-height:1.5;color:var(--ib-text);overflow-wrap:anywhere}
.ib-overlay .ib-search-actions{display:flex;gap:8px;margin-top:8px}
.ib-overlay .ib-icon-btn{width:32px;height:30px;border-radius:8px;border:1px solid var(--ib-hair);background:var(--ib-bg);color:var(--ib-soft)}
.ib-overlay .ib-icon-btn[data-ready=true]{color:var(--ib-accent-ink);background:var(--ib-accent-soft);border-color:var(--ib-accent-line)}
.ib-overlay .ib-icon-btn[data-ready=false]{opacity:.85;filter:none}
/* ── 模板管理：默认模板标记 ─────────────────────────────────────────────── */
.ib-overlay .ib-default-badge{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;background:var(--ib-accent-soft);color:var(--ib-accent-ink);font-size:13px;font-weight:600}
.ib-overlay .ib-tm-card[data-default=true]{border-left:3px solid var(--ib-accent);padding-left:12px}
.ib-overlay .ib-tm-title b{font-size:16px;font-weight:600}
.ib-overlay .ib-lit-btn{height:32px;padding:0 11px;border-radius:8px;border:1px solid var(--ib-hair);background:var(--ib-bg);color:var(--ib-text);font-size:13.5px;font-weight:500;display:inline-flex;align-items:center;gap:6px}
.ib-overlay .ib-lit-btn:hover:enabled{background:var(--ib-hover);border-color:var(--ib-accent-line)}
.ib-overlay .ib-lit-btn[data-ready=true]{color:var(--ib-accent-ink);background:var(--ib-accent-soft);border-color:var(--ib-accent-line)}
/* ── 会话标题旁的「Agent 预设」标识：按需求 §2.1 删除 ──────────────────────
   DSH 的 ui-agent-preset 会在会话标题右侧渲染一个只读 label（预设名，对我们
   就是「iBM科研Agent」），与产品品牌重复。它是 list 槽位的一项，插件无法用
   占位替换，只能用 CSS 隐去；这里用 DSH 自带的稳定标记
   data-conversation-header-corner 锚定会话头部，且只挑 span 型 label，
   避免误伤头部其它控件。 */
header:has([data-conversation-header-corner]) span[class*='_label']{display:none!important}
/* ── 次级界面（研究设计 / 表征 / 全文队列 / 预览 / 模板）字号同步放大 ──────
   需求 §6：所有条目在布局协调的前提下尽量使用较大字号。这些界面原本是
   9–11px 的密集排版，这里统一提到 13–14px（不靠缩字解决空间不足）。 */
.ib-overlay :is(.ib-field label,.ib-req label){font-size:14px}
.ib-overlay .ib-chip{font-size:13px;padding:2px 8px}
.ib-overlay :is(.ib-help,.ib-dl-main b,.ib-review-detail-head b,.ib-search-citation,.ib-tm-title b){font-size:14px}
.ib-overlay :is(.ib-help strong,.ib-version,.ib-key,.ib-tm-sub,.ib-dl-main small,.ib-dl-state,
  .ib-review-detail-head span,.ib-review-finding,.ib-preview-title small,.ib-preview-foot-note,
  .ib-preview-state,.ib-tm-btn,.ib-tm-chip,.sw-head p,.sw-select,.sw-step-id,.sw-step-preview,
  .sw-cond,.sw-note,.sw-analy-block,.sw-plan-row,.sw-mini-btn,.sw-hint,.sw-plan-empty,
  .sw04-reaction-side>small,.sw04-arrow>span,.sw04-plan-preview p,.sw04-plan-preview li,
  .sw04-plan-preview h4,.sw04-plan-grid span,.sw04-structure-candidate-head small){font-size:13.5px}
.ib-overlay :is(.sw-meta-note,.sw-ev-meta,.sw-ev-tag,.sw-metric small,.sw-metric strong,
  .sw-struct-name,.sw-struct-src,.sw-ev-act button,.sw-struct-acts .sw-mini-btn,
  .sw-ev-shot-note,.sw-ev-shot-fail,.sw-cond .sw-src,.sw-analy-block b,.sw-review-quote,
  .sw04-difficulty,.sw04-plan-preview-head small){font-size:13px}
.ib-overlay :is(.sw-head h3,.ib-preview-title b){font-size:16px}
.ib-overlay .ib-preview-btn{height:32px;padding:0 12px;border-radius:8px;font-size:13.5px;border:1px solid var(--ib-hair);background:var(--ib-bg)}
.ib-overlay .ib-preview-btn[data-primary=true]{background:var(--ib-accent);border-color:transparent;color:#fff}
.ib-overlay .ib-preview-btn[data-danger=true]{color:#b42318}
.ib-overlay :is(.ib-approval-card>p,.ib-approval-ok span){font-size:14px}
.ib-overlay :is(.ib-fulltext-note,.ib-lit-note,.ib-sub){font-size:13.5px;color:var(--ib-soft)}
.ib-overlay .ib-table-head{font-size:13.5px;color:var(--ib-soft);border-bottom:1px solid var(--ib-hair)}
.ib-overlay .ib-table-row{font-size:14px}
/* ── Hero（空白新会话）里的课题选择框 ────────────────────────────────────
   和 DSH 的工作目录 chip 并排，高度/圆角对齐；菜单是普通绝对定位弹层，
   hero 行不在滚动容器里，不会被裁切。 */
.ib-hero-project{position:relative;display:inline-flex;align-items:center}
.ib-hero-chip{display:inline-flex;align-items:center;gap:7px;height:30px;max-width:260px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,var(--ib-hair));border-radius:15px;background:var(--ib-bg);color:var(--dsw-alias-label-primary,var(--ib-text));font-size:13px;font-weight:500;line-height:1;cursor:pointer}
.ib-hero-chip:hover{background:var(--ib-hover)}
.ib-hero-chip[aria-expanded=true]{background:var(--ib-hover);border-color:var(--ib-accent-line)}
.ib-hero-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib-hero-chip-caret{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,var(--ib-soft))}
.ib-hero-menu{position:absolute;left:0;bottom:calc(100% + 8px);z-index:60;min-width:260px;max-width:min(420px,90vw);max-height:52vh;overflow:auto;display:grid;padding:6px;background:var(--ib-bg);border:1px solid var(--ib-hair);border-radius:12px;box-shadow:0 16px 40px rgba(15,23,42,.16)}
.ib-hero-menu-item{display:grid;gap:2px;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:8px;background:none;color:var(--ib-text);font-size:13.5px;cursor:pointer}
.ib-hero-menu-item:hover:enabled{background:var(--ib-hover)}
.ib-hero-menu-item[data-active=true]{background:var(--ib-accent-soft);color:var(--ib-accent-ink)}
.ib-hero-menu-item b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib-hero-menu-item small{font-size:12px;color:var(--dsw-alias-label-tertiary,var(--ib-soft))}
.ib-hero-menu-item-strong{border-top:1px solid var(--ib-hair);border-radius:0 0 8px 8px;margin-top:4px;padding-top:10px;color:var(--ib-accent-ink)}
.ib-hero-menu-empty{padding:8px 10px;font-size:13px;color:var(--dsw-alias-label-tertiary,var(--ib-soft))}
.ib-hero-menu-sep{padding:8px 10px 4px;font-size:12px;color:var(--dsw-alias-label-tertiary,var(--ib-soft))}
/* ── 窄宽度（右侧栏课题 tab / 面板嵌入）────────────────────────────────── */
.ib-overlay.ib-panel-embed .ib-main{padding:14px 14px 32px}
.ib-overlay.ib-panel-embed .ib-project-head{flex-wrap:wrap;align-items:flex-start;gap:10px}
.ib-overlay.ib-panel-embed .ib-project-copy{flex:1 1 100%;order:-1}
.ib-overlay.ib-panel-embed .ib-project-copy h1{font-size:20px}
.ib-overlay.ib-panel-embed .ib-head h1{font-size:22px}
.ib-overlay.ib-panel-embed .ib-tabs{gap:18px}
/* 侧栏一列宽度放不下「标题 + 操作区」时，按钮移到标题下面（需求 §3.2：
   宽度不足优先换行，不缩小字号）。桌面宽面板保持按钮在右侧。 */
@media(max-width:720px){
  .ib-overlay .ib-lit-row,.ib-overlay.ib-panel-embed .ib-lit-row{grid-template-columns:minmax(0,1fr);align-items:flex-start}
  .ib-overlay .ib-lit-acts,.ib-overlay.ib-panel-embed .ib-lit-acts{justify-content:flex-start;max-width:100%}
  .ib-overlay .ib-main{padding:18px 14px 48px}
}
/* 同一份判断的容器版：右侧栏课题 tab 的列宽只有 360–560px，但浏览器视口很宽，
   视口媒体查询看不到这种"容器很窄"的情况，所以按分组宽度再判一次。 */
@container (max-width:700px){
  .ib-overlay .ib-lit-row{grid-template-columns:minmax(0,1fr);align-items:flex-start}
  .ib-overlay .ib-lit-acts{justify-content:flex-start;max-width:100%}
}
`;
