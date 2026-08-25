/** iBM Lab Agent — project-first Harness client. */
window.__ModuleLoader__.load({
	id: "dsh-lab-agent",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");
		const { useState, useEffect, useCallback, useRef } = React;
		const h = React.createElement;

		const css = [
			":root{--ib-bg:#06110f;--ib-panel:#0c1d19;--ib-panel2:#102720;--ib-line:rgba(129,205,178,.16);--ib-text:#eff9f5;--ib-muted:#88a69b;--ib-green:#51d4a3;--ib-cyan:#73dce6;--ib-red:#ff8989}",
			".ib-overlay{position:fixed;inset:0;z-index:1000;overflow:auto;background:radial-gradient(circle at 80% -10%,rgba(64,182,145,.18),transparent 32%),var(--ib-bg);color:var(--ib-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
			".ib-top{height:68px;position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid var(--ib-line);background:rgba(6,17,15,.9);backdrop-filter:blur(18px)}",
			".ib-brand{display:flex;align-items:center;gap:11px;min-width:230px}.ib-logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,var(--ib-green),#238e72);color:#062018;font-weight:900;box-shadow:0 9px 28px rgba(81,212,163,.18)}.ib-brand strong{font-size:14px}.ib-brand small{display:block;margin-top:2px;color:#78978c;font-size:9px;letter-spacing:.12em;text-transform:uppercase}.ib-crumb{flex:1;color:#8ea99f;font-size:11px}.ib-crumb b{color:#e8f7f1}",
			".ib-main{max-width:1260px;margin:0 auto;padding:36px 28px 70px}.ib-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:26px}.ib-kicker{color:var(--ib-green);font-size:9.5px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.ib-head h1{font-size:30px;line-height:1.16;letter-spacing:-.035em;margin:8px 0}.ib-head p{max-width:690px;color:var(--ib-muted);font-size:12.5px;line-height:1.7;margin:0}",
			".ib-btn{border:1px solid var(--ib-line);background:rgba(255,255,255,.035);color:#d5e9e1;border-radius:10px;padding:9px 13px;cursor:pointer;font-size:11.5px}.ib-btn:hover{border-color:rgba(81,212,163,.36);background:rgba(81,212,163,.07)}.ib-btn[data-primary]{border-color:transparent;background:linear-gradient(135deg,#41c797,#27866d);color:white;box-shadow:0 10px 25px rgba(36,151,113,.19)}.ib-btn:disabled{opacity:.45;cursor:not-allowed}.ib-actions{display:flex;gap:8px;flex-wrap:wrap}",
			".ib-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.ib-project{position:relative;min-height:190px;border:1px solid var(--ib-line);background:linear-gradient(145deg,rgba(15,38,32,.94),rgba(9,25,21,.88));border-radius:17px;padding:19px;cursor:pointer;text-align:left;color:inherit;transition:.18s}.ib-project:hover{transform:translateY(-2px);border-color:rgba(81,212,163,.38)}.ib-project-icon{width:38px;height:38px;border-radius:12px;background:rgba(81,212,163,.12);color:var(--ib-green);display:grid;place-items:center;font-weight:800}.ib-project h2{font-size:16px;margin:24px 0 6px}.ib-project p{font-size:10.5px;color:#76948a;line-height:1.55;margin:0}.ib-project-foot{position:absolute;left:19px;right:19px;bottom:17px;display:flex;justify-content:space-between;color:#648279;font-size:9.5px}",
			".ib-card{border:1px solid var(--ib-line);background:rgba(11,29,24,.83);border-radius:16px;padding:17px}.ib-form{margin-bottom:18px}.ib-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.ib-field{display:grid;gap:6px}.ib-field[data-wide]{grid-column:1/-1}.ib-field label{font-size:10px;color:#78958b}.ib-field input,.ib-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:#071611;color:var(--ib-text);border-radius:10px;padding:10px 11px;font:11.5px inherit;outline:none}.ib-field textarea{min-height:180px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.55}.ib-field input:focus,.ib-field textarea:focus{border-color:rgba(81,212,163,.48)}.ib-form-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.ib-error{color:var(--ib-red);font-size:10.5px;margin:10px 0;white-space:pre-wrap}.ib-empty{border:1px dashed rgba(129,205,178,.23);border-radius:17px;padding:50px 24px;text-align:center;color:#739087}",
			".ib-project-head{display:flex;align-items:center;gap:13px;margin-bottom:20px}.ib-project-copy{flex:1;min-width:0}.ib-project-copy h1{font-size:24px;margin:0 0 4px;letter-spacing:-.025em}.ib-project-copy p{font-size:10.5px;color:#78978c;margin:0}.ib-agent{display:flex;align-items:center;gap:8px}.ib-spark{width:23px;height:23px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.15)}",
			".ib-memory{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:14px;margin-bottom:17px}.ib-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.ib-card-title{font-size:12.5px;font-weight:680}.ib-chip{border-radius:999px;background:rgba(81,212,163,.1);color:#6ee3b5;padding:3px 8px;font-size:9px}.ib-memory textarea{width:100%;min-height:230px;box-sizing:border-box;resize:vertical;border:1px solid rgba(129,205,178,.12);background:#071611;color:#cfe3db;border-radius:11px;padding:13px;font:10.5px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.ib-save{display:flex;gap:8px;margin-top:9px}.ib-save input{flex:1;min-width:0;border:1px solid var(--ib-line);background:#071611;color:inherit;border-radius:9px;padding:8px 10px;font-size:10.5px;outline:none}.ib-help{color:#78958b;font-size:10.5px;line-height:1.65}.ib-help strong{display:block;color:#d6e9e2;font-size:11.5px;margin-bottom:7px}.ib-history{margin-top:12px;display:grid;gap:7px}.ib-version{border-top:1px solid rgba(129,205,178,.1);padding-top:8px;display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:#78958b}.ib-version b{color:#bed5cc}",
			".ib-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}.ib-tab{border:1px solid var(--ib-line);background:rgba(255,255,255,.02);color:#9db8ae;border-radius:13px;padding:13px;text-align:left;cursor:pointer}.ib-tab[data-active=true]{border-color:rgba(81,212,163,.4);background:linear-gradient(125deg,rgba(81,212,163,.13),rgba(115,220,230,.04));color:white}.ib-tab strong{display:block;font-size:12px;margin-bottom:4px}.ib-tab span{font-size:9.5px;color:#718f85}",
			".ib-board{border:1px solid var(--ib-line);background:rgba(10,26,22,.7);border-radius:16px;padding:17px}.ib-board-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.ib-board-head h2{font-size:14px;margin:0}.ib-board-head p{font-size:9.5px;color:#6f8d83;margin:3px 0 0}.ib-artifacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ib-artifact{border:1px solid rgba(129,205,178,.11);background:rgba(255,255,255,.018);border-radius:12px;padding:13px;min-height:112px}.ib-artifact-top{display:flex;justify-content:space-between;align-items:center}.ib-artifact h3{font-size:11.5px;margin:0}.ib-count{font-size:19px;font-weight:720;color:var(--ib-green)}.ib-rows{display:grid;gap:6px;margin-top:10px}.ib-row{display:flex;justify-content:space-between;gap:9px;font-size:9.5px;color:#8ba69c}.ib-row b{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c8ddd5;font-weight:520}.ib-row span{flex:none;color:#78978c}.ib-artifact-empty{margin-top:15px;color:#627f75;font-size:9.5px;line-height:1.55}.ib-toast{position:fixed;right:24px;bottom:24px;border:1px solid rgba(81,212,163,.27);background:#102a22;border-radius:12px;padding:11px 14px;font-size:10.5px;box-shadow:0 12px 35px rgba(0,0,0,.3)}",

			".ib-db{margin-bottom:14px;border:1px solid rgba(81,212,163,.2);background:linear-gradient(140deg,rgba(16,44,35,.78),rgba(8,25,21,.72));border-radius:15px;padding:14px}.ib-db-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.ib-db-head h3{font-size:13px;margin:0 0 3px}.ib-db-head p{font-size:9.5px;color:#77978c;margin:0}.ib-db-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ib-db-card{border:1px solid rgba(129,205,178,.13);background:rgba(3,17,13,.38);border-radius:11px;padding:10px;min-width:0}.ib-db-name{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-bottom:8px}.ib-db-name b{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-db-tier{font-size:8px;color:#64877b;white-space:nowrap}.ib-db-state{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:8px}.ib-db-pill{border-radius:7px;padding:5px 6px;background:rgba(255,255,255,.035);color:#8ca99f;font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-db-pill[data-ok=true]{color:#78dfb8;background:rgba(81,212,163,.09)}.ib-db-pill[data-warn=true]{color:#f0c985;background:rgba(220,165,72,.08)}.ib-db-actions{display:flex;gap:5px}.ib-db-actions .ib-btn{flex:1;padding:6px 7px;font-size:9px}.ib-db-empty{padding:12px;text-align:center;color:#78978c;font-size:10px}@media(max-width:900px){.ib-db-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.ib-db-grid{grid-template-columns:1fr}}",
			".ib-db-toggle-wrap{display:flex;justify-content:flex-end;margin-bottom:10px}.ib-db-toggle{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(81,212,163,.26);background:rgba(81,212,163,.08);color:#bfe8d9;border-radius:10px;padding:8px 12px;cursor:pointer;font-size:10px}.ib-db-toggle:hover{border-color:rgba(81,212,163,.48);background:rgba(81,212,163,.14)}.ib-db-toggle i{width:7px;height:7px;border-radius:50%;background:#51d4a3}.ib-db-toggle[data-warn=true] i{background:#e4a354}.ib-db-toggle small{color:#73958a;font-size:8.5px}",
			".ib-fulltext{margin-bottom:14px;border:1px solid rgba(115,220,230,.2);background:linear-gradient(140deg,rgba(10,37,39,.74),rgba(7,24,21,.72));border-radius:15px;padding:14px}.ib-fulltext-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.ib-fulltext input{min-width:0;border:1px solid var(--ib-line);background:#071611;color:var(--ib-text);border-radius:10px;padding:10px 11px;font:11px inherit;outline:none}.ib-fulltext input:focus{border-color:rgba(115,220,230,.48)}.ib-fulltext-note{margin:8px 0 0;color:#73958b;font-size:9px;line-height:1.55}.ib-dl-list{display:grid;gap:6px;margin-top:10px}.ib-dl-row{display:flex;align-items:center;gap:9px;border-top:1px solid rgba(129,205,178,.1);padding-top:8px}.ib-dl-main{flex:1;min-width:0}.ib-dl-main b,.ib-dl-main small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-dl-main b{font-size:10px;color:#d6eae2}.ib-dl-main small{font-size:8.5px;color:#78978c;margin-top:2px}.ib-dl-state{flex:none;border-radius:999px;padding:4px 7px;background:rgba(255,255,255,.04);font-size:8.5px;color:#9cb6ad}.ib-dl-state[data-ok=true]{color:#78dfb8;background:rgba(81,212,163,.1)}.ib-dl-state[data-warn=true]{color:#f0c985;background:rgba(220,165,72,.09)}",

			// ── 文献管理两栏：左检索记录，右精读档案 ─────────────────────────────
			".ib-lit{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(0,.96fr);gap:12px;align-items:start}",
			".ib-lit-col{border:1px solid rgba(129,205,178,.11);background:rgba(255,255,255,.018);border-radius:12px;padding:13px;min-width:0}.ib-lit-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px}.ib-lit-head h3{font-size:13px;font-weight:700;margin:0;color:#e4f5ee}.ib-lit-head small{color:#7fa396;font-size:9px}.ib-lit-note{color:#6f8d83;font-size:9.5px;margin:2px 0 10px;line-height:1.5}",
			".ib-lit-list{display:grid;gap:7px}.ib-lit-row{display:flex;align-items:center;gap:9px;border:1px solid rgba(129,205,178,.12);background:rgba(7,22,17,.5);border-radius:11px;padding:9px 10px}.ib-lit-row[data-clickable]{cursor:pointer}.ib-lit-row[data-clickable]:hover{border-color:rgba(81,212,163,.45);background:rgba(81,212,163,.08)}.ib-lit-main{flex:1;min-width:0;display:grid;gap:2px}.ib-lit-main b{font-size:11px;color:#d8ebe3;font-weight:560;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-lit-main b i{font-family:Georgia,serif;font-weight:560}.ib-lit-main small{display:block;font-size:9px;color:#7fa396;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-lit-acts{flex:none;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px;max-width:58%}.ib-lit-btn{border:1px solid rgba(115,220,230,.28);border-radius:9px;background:rgba(115,220,230,.1);color:#c3ecf1;font-size:10px;padding:7px 10px;cursor:pointer;font-weight:560;line-height:1}.ib-lit-btn:hover{border-color:rgba(115,220,230,.5);background:rgba(115,220,230,.2)}.ib-lit-btn[data-review=approve]{border-color:rgba(81,212,163,.42);background:rgba(81,212,163,.13);color:#c9f5e3}.ib-lit-btn[data-review=reject]{border-color:rgba(255,137,137,.35);background:rgba(255,137,137,.08);color:#ffc0c0}.ib-lit-btn:disabled{opacity:.4;pointer-events:none}.ib-lit-fmt{border:1px solid rgba(115,220,230,.28);border-radius:9px;background:rgba(7,22,17,.5);color:#bfe8ee;font-size:10px;padding:6px 8px;cursor:pointer;outline:none}.ib-lit-fmt:hover{border-color:rgba(115,220,230,.5)}.ib-lit-fmt:focus{border-color:rgba(81,212,163,.5)}.ib-lit-fmt option{background:#0b2320;color:#e6f5ef}",
			".ib-lit-empty{border:1px dashed rgba(129,205,178,.35);border-radius:12px;padding:22px 14px;text-align:center;color:#75a089;font-size:10px;line-height:1.6}.ib-lit-overview{margin-top:8px;border:1px solid rgba(94,208,173,.24);border-radius:10px;background:rgba(94,208,173,.06);padding:10px 12px;font-size:10.2px;line-height:1.75;color:#bde0d2;white-space:pre-wrap}.ib-lit-overview b{display:block;color:#e9f9f2;font-size:10.5px;margin-bottom:4px}.ib-review-detail{margin-top:8px;border:1px solid rgba(115,220,230,.22);border-radius:10px;background:rgba(115,220,230,.045);padding:10px 12px;color:#a9ccc7}.ib-review-detail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.ib-review-detail-head b{font-size:10.5px;color:#e4f6f1}.ib-review-detail-head span{font-size:9px;color:#7fa39a}.ib-review-findings{display:grid;gap:5px}.ib-review-finding{display:grid;grid-template-columns:44px 1fr;gap:7px;font-size:9.5px;line-height:1.55}.ib-review-finding i{font-style:normal;text-transform:uppercase;font-size:8px;color:#75a092}.ib-review-finding[data-level=error] i{color:#ff9696}.ib-review-finding[data-level=warning] i{color:#e9b56f}.ib-review-finding[data-level=pass] i{color:#5fd4a8}",
			".ib-search-results{margin:-1px 4px 4px;border:1px solid rgba(115,220,230,.18);border-top:0;border-radius:0 0 11px 11px;background:rgba(4,17,14,.55);padding:8px;display:grid;gap:6px;max-height:420px;overflow:auto}.ib-search-paper{border-top:1px solid rgba(129,205,178,.1);padding:7px 5px 2px}.ib-search-paper:first-child{border-top:0}.ib-search-citation{font-size:10.5px;line-height:1.5;color:#dbece6}.ib-search-citation i{font-family:Georgia,serif;color:#f0faf6}.ib-search-citation span{color:#83cdb1}.ib-search-paper small{display:block;margin-top:2px;color:#6f9286;font-size:8.8px;line-height:1.4}.ib-search-paper a{color:#82dce6;text-decoration:none;margin-left:7px}.ib-search-paper a:hover{text-decoration:underline}",
			".ib-preview-backdrop{position:fixed;inset:0;z-index:1004;background:rgba(3,14,11,.42);backdrop-filter:blur(2px)}.ib-preview-drawer{position:fixed;z-index:1005;top:0;right:0;bottom:0;width:min(760px,68vw);display:flex;flex-direction:column;background:#f4f7f6;color:#17382f;border-left:1px solid rgba(36,130,99,.22);box-shadow:-28px 0 70px rgba(3,25,18,.24)}.ib-preview-head{flex:none;display:flex;align-items:center;gap:10px;padding:14px 16px;background:#fff;border-bottom:1px solid rgba(45,130,101,.14)}.ib-preview-title{min-width:0;flex:1}.ib-preview-title b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.ib-preview-title small{display:block;margin-top:3px;color:#718b82;font-size:9.5px}.ib-preview-state{border-radius:999px;padding:4px 8px;background:#eef6f3;color:#31745e;font-size:9px}.ib-preview-frame{min-height:0;flex:1;width:100%;border:0;background:#59615e}.ib-preview-foot{flex:none;display:flex;align-items:center;gap:8px;padding:11px 14px;background:#fff;border-top:1px solid rgba(45,130,101,.14)}.ib-preview-foot-note{min-width:0;flex:1;color:#70867e;font-size:9.5px;line-height:1.45}.ib-preview-btn{border:1px solid rgba(43,132,101,.22);background:#fff;color:#286f58;border-radius:9px;padding:8px 12px;cursor:pointer;font-size:10px;white-space:nowrap}.ib-preview-btn[data-primary]{border-color:#35a97e;background:#35a97e;color:white}.ib-preview-btn[data-danger]{border-color:rgba(190,80,80,.3);color:#a94c4c}.ib-preview-btn:disabled{opacity:.45;cursor:not-allowed}.ib-preview-review{flex:none;max-height:190px;overflow:auto;padding:12px 14px;background:#f9fbfa;border-top:1px solid rgba(45,130,101,.14)}.ib-preview-review .ib-review-detail{margin:0;background:#fff;color:#476b61}.ib-preview-review .ib-review-detail-head b{color:#17382f}.ib-approval-shade{position:absolute;inset:0;z-index:2;display:grid;place-items:center;padding:24px;background:rgba(9,28,22,.55);backdrop-filter:blur(3px)}.ib-approval-card{width:min(560px,100%);max-height:min(650px,86vh);overflow:auto;box-sizing:border-box;border:1px solid #c9ddd5;border-radius:17px;background:#fff;padding:22px;box-shadow:0 22px 70px rgba(4,28,20,.28)}.ib-approval-card h3{margin:0 0 7px;font-size:17px}.ib-approval-card>p{margin:0 0 14px;color:#668178;font-size:10.5px;line-height:1.65}.ib-approval-card .ib-review-detail{margin:0;background:#f7faf9;color:#476b61}.ib-approval-card .ib-review-detail-head b{color:#17382f}.ib-approval-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.ib-approval-ok{display:grid;place-items:center;text-align:center;padding:18px 8px}.ib-approval-ok strong{font-size:16px}.ib-approval-ok span{margin-top:6px;color:#668178;font-size:10px}",
			"@media(max-width:880px){.ib-lit{grid-template-columns:1fr}.ib-preview-drawer{width:100vw}}",
			// ── 模板管理：阅读笔记模板 / PPT 模板 ─────────────────────────────
			".ib-tm-tabs{display:flex;gap:9px;margin-bottom:12px}.ib-tm-tab{border:1px solid var(--ib-line);background:rgba(255,255,255,.02);color:#9db8ae;border-radius:13px;padding:12px 16px;cursor:pointer;font-size:11.5px}.ib-tm-tab[data-active=true]{border-color:rgba(81,212,163,.4);background:linear-gradient(125deg,rgba(81,212,163,.13),rgba(115,220,230,.04));color:white}.ib-tm-wrap{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ib-card-detail{grid-column:1/-1}.ib-table{border:1px solid rgba(129,205,178,.12);border-radius:11px;overflow:hidden}.ib-table-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid rgba(129,205,178,.08)}.ib-table-row:first-child{border-top:0}.ib-table-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(81,212,163,.05);font-size:9.5px;color:#9db8ad;font-weight:700}.ib-table-head .ib-tm-id,.ib-table-row .ib-tm-id{width:150px;flex:none}.ib-table-head .ib-tm-name,.ib-table-row .ib-tm-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ib-table-head .ib-tm-status,.ib-table-row .ib-tm-status{width:70px;flex:none}.ib-table-head .ib-tm-actions,.ib-table-row .ib-tm-actions{width:280px;flex:none;display:flex;gap:6px;justify-content:flex-end}",
			".ib-tm-btn{font-size:9.5px}",
			".ib-sections{display:grid;gap:6px;margin-top:8px}.ib-section-row{display:grid;grid-template-columns:1fr 2fr 70px 28px;gap:6px;align-items:center}.ib-section-row input[type=checkbox]{accent-color:var(--ib-green)}.ib-section-row input[type=text]{border:1px solid #ccc;border-radius:7px;padding:6px 8px;background:#0b2320;color:var(--ib-text);font-size:10.5px;width:100%;box-sizing:border-box}.ib-section-row .ib-mini{width:100%}",
			".vertical-stack{display:flex;flex-direction:column;gap:4px}.ib-req{display:grid;gap:4px}.ib-req label{font-size:9.5px;color:#78958b}.ib-req input,.ib-req textarea{width:100%;box-sizing:border-box;border:1px solid var(--ib-line);background:#071611;color:var(--ib-text);border-radius:7px;padding:7px 9px;font:10.5px inherit;outline:none}.ib-req textarea{min-height:60px;resize:vertical}",
			".ib-sidebar{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;padding:7px 10px;font-size:13px;border-radius:8px}.ib-sidebar:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}.ib-sidebar-logo{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:linear-gradient(145deg,#55d6a4,#26876d);color:#052019;font-size:9px;font-weight:bold}",
			".ib-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(129,205,178,.22);background:rgba(81,212,163,.09);color:#bde6d6;border-radius:999px;padding:5px 11px;font-size:10px;cursor:pointer;line-height:1.4}.ib-badge:hover{border-color:rgba(81,212,163,.45);background:rgba(81,212,163,.15)}.ib-badge-mark{color:var(--ib-green);font-size:9px;font-weight:800}.ib-badge b{color:#e6f7f0;font-weight:650}.ib-badge small{color:#7fa396}",
			".ib-hint{display:flex;align-items:center;gap:8px;color:#86a79b;font-size:10px;padding:4px 2px;line-height:1.5}.ib-hint b{color:#cfe5dc;font-weight:620}.ib-hint button{margin-left:auto;border:1px solid rgba(129,205,178,.2);background:rgba(255,255,255,.03);color:#a9c8bd;border-radius:8px;padding:3px 9px;font-size:9.5px;cursor:pointer}.ib-hint button:hover{border-color:rgba(81,212,163,.4);color:#e0f2ea}",
			// ── Harness 科研对话：课题上下文、消息流、工具卡与输入区 ──────────
			".ib-research-badge{min-width:0;display:flex;align-items:center;gap:9px;border:1px solid rgba(51,176,132,.2);background:linear-gradient(135deg,rgba(70,198,153,.12),rgba(115,220,230,.055));color:var(--dsw-alias-label-primary,#193a31);border-radius:12px;padding:6px 10px 6px 7px;cursor:pointer;text-align:left;box-shadow:0 6px 22px rgba(21,103,78,.06)}.ib-research-badge:hover{border-color:rgba(51,176,132,.42);background:linear-gradient(135deg,rgba(70,198,153,.18),rgba(115,220,230,.08))}.ib-research-badge .ib-badge-icon{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;background:linear-gradient(145deg,#51d4a3,#278b70);box-shadow:0 5px 14px rgba(46,163,123,.2)}.ib-research-badge .ib-badge-copy{min-width:0;display:grid;gap:1px}.ib-research-badge small{font-size:8px;line-height:1.1;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#78978c)}.ib-research-badge b{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:1.25;color:var(--dsw-alias-label-primary,#15382e)}.ib-research-badge .ib-badge-version{flex:none;border-radius:999px;padding:2px 6px;background:rgba(61,188,143,.1);color:#329374;font-size:8.5px;font-weight:700}",
			"body.ib-research-chat{--ib-chat-ink:var(--dsw-alias-label-primary,#18352d);--ib-chat-muted:var(--dsw-alias-label-secondary,#647d74);--ib-chat-line:rgba(50,142,111,.13)}body.ib-research-chat [class*='_centerCol']{background:radial-gradient(circle at 78% 6%,rgba(81,212,163,.09),transparent 27%),linear-gradient(180deg,rgba(244,251,248,.72),rgba(255,255,255,.96) 210px);color:var(--ib-chat-ink)}body.ib-research-chat [class*='_centerCol'] header{height:84px;box-sizing:border-box;border-bottom:1px solid var(--ib-chat-line);background:rgba(250,253,252,.88);backdrop-filter:blur(18px) saturate(1.15);box-shadow:0 8px 28px rgba(40,111,88,.035)}body.ib-research-chat [class*='_scrollBody']{background-image:linear-gradient(rgba(56,139,111,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(56,139,111,.018) 1px,transparent 1px);background-size:28px 28px}body.ib-research-chat [class*='_scrollBody']:before{content:'RESEARCH LOG';position:fixed;right:24px;top:102px;z-index:0;color:rgba(45,126,99,.12);font-size:8px;font-weight:800;letter-spacing:.22em;pointer-events:none}body.ib-research-chat [class*='_scrollBody'] [class*='_column']{max-width:820px!important}body.ib-research-chat [class*='_flowItem']{margin-block:8px}body.ib-research-chat [class*='_flowItem']:has([class*='_markdown']){position:relative;border-left:2px solid rgba(61,178,137,.17);padding-left:18px}body.ib-research-chat [class*='_flowItem']:has([class*='_userRow']){border-left:0;padding-left:0;margin-block:14px}body.ib-research-chat [class*='_userStack']{border:1px solid rgba(44,153,116,.17);background:linear-gradient(135deg,rgba(71,190,148,.11),rgba(118,216,225,.055));border-radius:16px 16px 5px 16px;padding:10px 13px;box-shadow:0 7px 22px rgba(42,123,96,.045)}body.ib-research-chat [class*='_flowItem'] button{border-radius:10px}body.ib-research-chat [class*='_flowItem'] [class*='_card']{border-color:rgba(55,145,115,.13);background:rgba(250,253,252,.78);box-shadow:0 4px 16px rgba(39,103,82,.035)}body.ib-research-chat [class*='_markdown']{color:var(--ib-chat-ink);font-size:14px;line-height:1.82}body.ib-research-chat [class*='_markdown'] h1,body.ib-research-chat [class*='_markdown'] h2,body.ib-research-chat [class*='_markdown'] h3{color:#163c31;letter-spacing:-.015em}body.ib-research-chat [class*='_markdown'] h2{margin-top:1.6em;padding-bottom:.35em;border-bottom:1px solid rgba(49,145,113,.12)}body.ib-research-chat [class*='_markdown'] code{border:1px solid rgba(51,142,112,.1);background:rgba(48,133,105,.065);color:#226e55;border-radius:6px}body.ib-research-chat [class*='_markdown'] blockquote{border-left:3px solid #51c99a;background:rgba(81,201,154,.055);border-radius:0 10px 10px 0;padding:8px 13px}body.ib-research-chat [class*='_tableScroll']{border:1px solid rgba(49,145,113,.14);border-radius:12px;box-shadow:0 6px 18px rgba(35,103,80,.035)}body.ib-research-chat [class*='_composerSeat']{background:linear-gradient(180deg,rgba(251,253,252,0),rgba(249,252,251,.92) 30%)}body.ib-research-chat [class*='_composerStack']{gap:8px}body.ib-research-chat [class*='_composerStack'] [class*='_card']{border-color:rgba(42,157,118,.19);background:rgba(255,255,255,.94);border-radius:18px;box-shadow:0 14px 38px rgba(28,109,81,.09),0 0 0 1px rgba(255,255,255,.5) inset}body.ib-research-chat [class*='_composerStack'] textarea{color:var(--ib-chat-ink);font-size:13px}body.ib-research-chat [class*='_composerStack'] textarea::placeholder{color:#9badA7}",
			// Harness 用独立 backdrop 绘制输入文字；原生 textarea 只负责光标与输入，保持文字透明可避免双层重影。
			"body.ib-research-chat [class*='_composerStack'] textarea{color:transparent;font-size:inherit;caret-color:var(--ib-chat-ink)}",
			"@media(prefers-color-scheme:dark){body.ib-research-chat [class*='_centerCol']{background:radial-gradient(circle at 78% 6%,rgba(81,212,163,.08),transparent 28%),#07130f}body.ib-research-chat [class*='_centerCol'] header{background:rgba(7,19,15,.9)}body.ib-research-chat [class*='_userStack']{background:linear-gradient(135deg,rgba(61,177,136,.14),rgba(31,89,74,.14))}body.ib-research-chat [class*='_flowItem'] [class*='_card']{background:rgba(13,31,25,.75)}body.ib-research-chat [class*='_markdown'] h1,body.ib-research-chat [class*='_markdown'] h2,body.ib-research-chat [class*='_markdown'] h3{color:#e5f5ef}body.ib-research-chat [class*='_composerSeat']{background:linear-gradient(180deg,rgba(7,19,15,0),rgba(7,19,15,.92) 30%)}body.ib-research-chat [class*='_composerStack'] [class*='_card']{background:rgba(13,31,25,.96)}}",
			"@media(max-width:760px){.ib-research-badge small,.ib-research-badge .ib-badge-version{display:none}body.ib-research-chat [class*='_centerCol'] header{height:auto;min-height:72px}body.ib-research-chat [class*='_scrollBody'] [class*='_column']{max-width:calc(100vw - 24px)!important}}",
			"@media(max-width:900px){.ib-grid{grid-template-columns:repeat(2,1fr)}.ib-memory{grid-template-columns:1fr}.ib-artifacts{grid-template-columns:1fr}}@media(max-width:620px){.ib-top{padding:0 14px}.ib-brand{min-width:auto}.ib-brand div:last-child,.ib-crumb{display:none}.ib-main{padding:25px 14px 55px}.ib-head{align-items:flex-start;flex-direction:column}.ib-grid,.ib-tabs,.ib-form-grid{grid-template-columns:1fr}.ib-head h1{font-size:24px}.ib-project-head{flex-wrap:wrap}.ib-agent{width:100%;justify-content:center}}",
			// ── 品牌覆盖：左上角 iBM Agent（烧瓶 + based on DSH，配色与课题面板一致）──
			".ib-brand-shell{display:flex;align-items:center;gap:10px;min-width:0}.ib-brand-flask{width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;background:linear-gradient(145deg,#51d4a3,#238e72);box-shadow:0 6px 18px rgba(81,212,163,.2)}.ib-brand-flask svg{width:18px;height:18px}.ib-brand-text{min-width:0}.ib-brand-text b{display:block;color:var(--dsw-alias-label-primary,#eff9f5);font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.1;white-space:nowrap}.ib-brand-text small{display:block;color:var(--dsw-alias-label-tertiary,#88a69b);font-size:8.5px;letter-spacing:.13em;text-transform:uppercase;margin-top:2px;white-space:nowrap}",
			"[class*='_toggle']{position:relative}.ib-rail-flask{position:absolute;inset:0;margin:auto;width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:linear-gradient(145deg,#51d4a3,#238e72);box-shadow:0 4px 12px rgba(81,212,163,.18)}.ib-rail-flask svg{width:13px;height:13px}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=dsh-lab-agent]") === null) {
			const style = document.createElement("style");
			style.dataset.pluginCss = "dsh-lab-agent";
			style.textContent = css;
			document.head.appendChild(style);
		}

		const pass = { parse: (value) => value };
		const strict = (symbol) => ({ mode: "strict", typeSymbol: symbol, schema: pass });
		const direct = (method, params = []) => ({ id: `dsh-lab-agent#lab/${method}`, service: "lab", namespace: "lab", method, invocation: { kind: "direct" }, parameters: params.map((wire) => ({ name: wire, wire, source: "json", codec: strict(`dsh-lab-agent#lab/${method}:${wire}`) })), result: strict(`dsh-lab-agent#lab/${method}:result`) });
		const descriptors = [
			...["versions_list", "goals_list", "templates_list", "note_templates_list", "nmr_list", "convert_available", "convert_runs", "python_preflight", "cas_policy", "cas_login_entry"].map((name) => direct(name)),
			...["versions_resolve", "goals_resolve", "goals_create", "goals_update", "goals_copy", "goals_delete", "goals_requirements", "templates_resolve", "templates_preview", "templates_validate", "templates_import", "templates_confirm", "templates_update_meta", "templates_archive", "note_templates_resolve", "note_templates_create", "note_templates_update", "note_templates_copy", "note_templates_delete", "note_templates_requirements", "projects_create", "projects_get", "projects_ensure_workspace", "projects_bind_workspace", "projects_bind_session", "projects_binding", "projects_by_session", "projects_by_workspace", "projects_by_cwd", "projects_memory", "projects_memory_update", "projects_workspace", "tasks_searches", "tasks_provenance", "literature_status", "literature_configure", "literature_connect", "literature_verify", "literature_download_create", "literature_downloads", "literature_download_retry", "tasks_search_create", "tasks_bundle_create", "tasks_report_create", "tasks_report_complete", "tasks_report_validate", "tasks_report_review", "tasks_presentation_create", "tasks_presentation_complete", "tasks_presentation_validate", "tasks_presentation_review", "tasks_review_details", "tasks_search_ris", "tasks_overview", "tasks_report_download", "tasks_ppt_download", "chem_entities", "chem_entity_create", "chem_properties", "chem_formula", "chem_metrics", "chem_plans", "chem_plan_create", "chem_plan_validate", "chem_plan_status", "nmr_get", "nmr_create", "nmr_integrals", "nmr_approve", "nmr_written_back", "nmr_verify", "nmr_reopen", "nmr_calculate", "synth_targets", "synth_target_create", "synth_routes", "synth_route_create", "synth_route_step", "synth_route_status", "synth_evidence", "cas_prepare_query", "convert_upload"].map((name) => direct(name, ["request"])),
			direct("projects_list")
		];

		const when = (value) => value ? new Date(value).toLocaleString() : "—";
		const titleOf = (row) => row.title || row.name || row.query || row.id;
		const statusOf = (row) => ({ succeeded: "已审核", pending: "待处理", running: "生成中", failed: "已退回", draft: "草稿", "under-review": "已暂存·待审核", approved: "已批准", prepared: "待分析", "approved-written": "已审核", "visually-verified": "已确认" })[row.status] || row.status || "已登记";

		/** 深拷贝阅读笔记模板 → 表单可编辑形态（数组隔离，避免污染原始数据）。 */
		function cloneForm(source) {
			if (!source) return {};
			const { id = "", name = "", audience = "课题组组会", language = "zh", length = "", topics = [], tags = [], sections = [], styleRules = [], evidenceRequirements = [], outputRequirements = [], remark = "", version } = source;
			return { id, name, audience, language, length, topics: [...topics], tags: [...tags], sections: sections.map((s) => ({ ...s })), styleRules: [...styleRules], evidenceRequirements: [...evidenceRequirements], outputRequirements: [...outputRequirements], remark, version };
		}

		/** 浏览器下载助手：text / base64 二进制 两类 blob 触发下载任务。 */
		function downloadBlob(fileName, mime, blob) {
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		}
		const downloadText = (fileName, mime, text) => {
			const type = mime || "text/plain;charset=utf-8";
			downloadBlob(fileName, type, new Blob([text], { type }));
		};
		const downloadBase64 = (fileName, mime, base64) => {
			const type = mime || "application/octet-stream";
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			downloadBlob(fileName, type, new Blob([bytes], { type }));
		};
		/** 同源二进制下载：先校验 Content-Length 与 SHA-256，再保存到 Windows。 */
		async function downloadVerifiedBinary(url) {
			const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
			if (!response.ok) throw new Error((await response.text()) || `下载失败（HTTP ${response.status}）`);
			const blob = await response.blob();
			const expectedBytes = Number(response.headers.get("content-length"));
			if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && blob.size !== expectedBytes) {
				throw new Error(`下载不完整：应为 ${expectedBytes} 字节，实际 ${blob.size} 字节；文件未保存，请重试。`);
			}
			const expectedHash = response.headers.get("x-content-sha256");
			if (expectedHash && globalThis.crypto?.subtle) {
				const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
				const actualHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
				if (actualHash !== expectedHash) throw new Error("下载校验失败（SHA-256 不一致）；文件未保存，请重试。");
			}
			const encodedName = response.headers.get("x-file-name") || "artifact.bin";
			let fileName = encodedName;
			try { fileName = decodeURIComponent(encodedName); } catch { /* 保留服务端原值 */ }
			downloadBlob(fileName, blob.type || "application/octet-stream", blob);
			return fileName;
		}

		function Artifact({ title, rows = [], empty }) {
			return h("section", { className: "ib-artifact" }, h("div", { className: "ib-artifact-top" }, h("h3", null, title), h("span", { className: "ib-count" }, rows.length)), rows.length ? h("div", { className: "ib-rows" }, rows.slice(0, 4).map((row, index) => h("div", { className: "ib-row", key: row.id || index }, h("b", { title: titleOf(row) }, titleOf(row)), h("span", null, statusOf(row))))) : h("div", { className: "ib-artifact-empty" }, empty));
		}

		const databaseState = (state) => ({ available: "可用", connected: "已连接", degraded: "受限", "auth-required": "需登录", "waiting-user": "等待登录", "agreement-required": "待勾选协议", "verification-required": "待验证", unavailable: "不可用", "not-supported": "不适用", idle: "未连接", "browser-open": "浏览器已打开", expired: "已过期", error: "异常", unknown: "未知" })[state] || state || "未知";
		const databaseStateTone = (state) => ({ "data-ok": ["available", "connected"].includes(state) ? "true" : undefined, "data-warn": ["auth-required", "waiting-user", "agreement-required", "verification-required", "degraded", "browser-open", "idle"].includes(state) ? "true" : undefined });

		/** 数据库实时状态总览：人工当前标签页与受控持久浏览器两种授权模式。 */
		function DatabaseOverview({ call, notify }) {
			const [snapshot, setSnapshot] = useState({ loading: true, sources: [], checkedAt: "", error: "" });
			const [busy, setBusy] = useState("");
			const [open, setOpen] = useState(false);
			const refresh = useCallback(async (force = false) => {
				try {
					const result = await call("literature_status", { request: { force } });
					setSnapshot({ loading: false, sources: result.sources || [], checkedAt: result.checkedAt || "", error: "" });
				} catch (reason) { setSnapshot((old) => ({ ...old, loading: false, error: reason.message })); }
			}, [call]);
			useEffect(() => {
				void refresh(false);
				const timer = setInterval(() => void refresh(false), 60000);
				return () => clearInterval(timer);
			}, [refresh]);
			const run = async (kind, source, mode) => {
				if (kind === "connect" && mode === "current") {
					window.open(source.institutionEntryUrl || source.entryUrl || "https://lib.ustc.edu.cn/", "_blank", "noopener,noreferrer");
				}
				setBusy(`${kind}:${source.id}`);
				try {
					const result = await call(kind === "connect" ? "literature_connect" : "literature_verify", { request: { sourceId: source.id, mode } });
					notify(result.message || result.connection?.message || "状态已更新");
					await refresh(true);
				} catch (reason) { notify(reason.message); } finally { setBusy(""); }
			};
			const attention = snapshot.sources.filter((source) => [source.search?.state, source.download?.state, source.connection?.state].some((state) => ["degraded", "auth-required", "waiting-user", "agreement-required", "verification-required", "expired", "error", "unavailable"].includes(state))).length;
			return h(React.Fragment, null,
				h("div", { className: "ib-db-toggle-wrap" }, h("button", { className: "ib-db-toggle", "data-warn": attention > 0 ? "true" : undefined, onClick: () => setOpen((value) => !value), "aria-expanded": open ? "true" : "false" }, h("i", { "aria-hidden": "true" }), open ? "收起数据库状态" : "数据库状态", h("small", null, snapshot.loading ? "验证中" : `${snapshot.sources.length} 个库${attention ? ` · ${attention} 个需处理` : ""}`))),
				open ? h("section", { className: "ib-db" },
				h("div", { className: "ib-db-head" }, h("div", null, h("h3", null, "文献数据库实时状态"), h("p", null, snapshot.checkedAt ? `最近验证 ${when(snapshot.checkedAt)} · 每 60 秒自动刷新` : "正在验证检索入口与全文权限状态")), h("button", { className: "ib-btn", disabled: snapshot.loading, onClick: () => void refresh(true) }, snapshot.loading ? "验证中…" : "立即验证")),
				snapshot.error ? h("div", { className: "ib-error" }, snapshot.error) : null,
				snapshot.sources.length ? h("div", { className: "ib-db-grid" }, snapshot.sources.map((source) => {
					const searchTone = databaseStateTone(source.search?.state);
					const downloadTone = databaseStateTone(source.download?.state);
					const connectionTone = databaseStateTone(source.connection?.state);
					return h("article", { className: "ib-db-card", key: source.id },
						h("div", { className: "ib-db-name" }, h("b", { title: source.name }, source.name), h("span", { className: "ib-db-tier" }, source.authMode === "institutional" ? "校内授权" : "开放源")),
						h("div", { className: "ib-db-state" }, h("span", { className: "ib-db-pill", title: source.search?.message, ...searchTone }, `检索 · ${databaseState(source.search?.state)}`), h("span", { className: "ib-db-pill", title: source.download?.message, ...downloadTone }, `下载 · ${databaseState(source.download?.state)}`), h("span", { className: "ib-db-pill", title: source.connection?.message, ...connectionTone }, `会话 · ${databaseState(source.connection?.state)}`)),
						source.authMode === "institutional" ? h("div", { className: "ib-db-actions" },
							h("button", { className: "ib-btn", title: "在当前 DSH 浏览器新标签页人工使用；不会把 Cookie 暴露给 DSH", disabled: !!busy, onClick: () => void run("connect", source, "current") }, "当前浏览器"),
							h("button", { className: "ib-btn", title: "启动可见的持久检索浏览器，支持登录状态复用和合法 PDF 捕获", disabled: !!busy || source.restrictedAutomation, onClick: () => void run("connect", source, "managed") }, busy === `connect:${source.id}` ? "启动中…" : "受控检索"),
							h("button", { className: "ib-btn", title: "登录、协议和验证码完成后验证当前会话", disabled: !!busy, onClick: () => void run("verify", source) }, busy === `verify:${source.id}` ? "验证中…" : "验证登录")
						) : null
					);
				})) : h("div", { className: "ib-db-empty" }, snapshot.loading ? "正在获取数据库状态…" : "暂无状态数据")
				) : null
			);
		}

		const downloadState = (state) => ({ queued: "排队中", "resolving-oa": "查找 OA", "waiting-login": "等待登录", "opening-publisher": "打开出版商", "locating-pdf": "定位 PDF", downloading: "校验中", completed: "已完成", "no-access": "无订阅权限", "verification-required": "需人工验证", failed: "失败" })[state] || state;

		/** InstSci 式全文队列：OA 优先，随后复用受控机构浏览器。 */
		function FullTextDownloader({ call, notify }) {
			const [identifier, setIdentifier] = useState("");
			const [jobs, setJobs] = useState([]);
			const [busy, setBusy] = useState(false);
			const load = useCallback(async () => {
				try { const result = await call("literature_downloads", { request: { limit: 8 } }); setJobs(result.jobs || []); }
				catch (reason) { notify(reason.message); }
			}, [call, notify]);
			useEffect(() => {
				void load();
				const timer = setInterval(() => void load(), jobs.some((job) => !["completed", "no-access", "verification-required", "failed", "waiting-login"].includes(job.state)) ? 2000 : 7000);
				return () => clearInterval(timer);
			}, [load, jobs]);
			const create = async () => {
				setBusy(true);
				try {
					await call("literature_download_create", { request: { identifier } });
					setIdentifier(""); notify("全文任务已创建：先查开放获取，再走中科大机构权限"); await load();
				} catch (reason) { notify(reason.message); } finally { setBusy(false); }
			};
			const retry = async (job) => {
				try { await call("literature_download_retry", { request: { id: job.id } }); notify("已复用当前受控浏览器会话重试"); await load(); }
				catch (reason) { notify(reason.message); }
			};
			return h("section", { className: "ib-fulltext" },
				h("div", { className: "ib-db-head" }, h("div", null, h("h3", null, "全文获取队列"), h("p", null, "开放获取优先 · 中科大授权后备 · 可见浏览器人工登录"))),
				h("div", { className: "ib-fulltext-form" }, h("input", { value: identifier, placeholder: "粘贴 DOI、论文落地页或 PDF 链接", onChange: (event) => setIdentifier(event.target.value), onKeyDown: (event) => { if (event.key === "Enter" && identifier.trim() && !busy) void create(); } }), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || !identifier.trim(), onClick: () => void create() }, busy ? "创建中…" : "查找并下载")),
				h("p", { className: "ib-fulltext-note" }, "登录、统一认证、勾选协议、验证码均由你在可见窗口中完成；系统不导出 Cookie。若任务显示“等待登录”，启动对应数据库的受控检索浏览器后点击重试。"),
				jobs.length ? h("div", { className: "ib-dl-list" }, jobs.map((job) => h("div", { className: "ib-dl-row", key: job.id },
					h("div", { className: "ib-dl-main" }, h("b", { title: job.title || job.identifier }, job.title || job.identifier), h("small", { title: job.message }, `${job.message}${job.route ? ` · ${job.route === "open-access" ? "开放获取" : "学校授权"}` : ""}${job.pageEstimate ? ` · 约 ${job.pageEstimate} 页` : ""}`)),
					h("span", { className: "ib-dl-state", "data-ok": job.state === "completed" ? "true" : undefined, "data-warn": ["waiting-login", "verification-required", "no-access"].includes(job.state) ? "true" : undefined }, downloadState(job.state)),
					job.state === "completed" ? h("button", { className: "ib-lit-btn", onClick: () => void downloadVerifiedBinary(job.downloadUrl).then((name) => notify(`已保存并校验 ${name}`)).catch((reason) => notify(reason.message)) }, "下载 PDF") : ["waiting-login", "verification-required", "failed"].includes(job.state) ? h("button", { className: "ib-lit-btn", onClick: () => void retry(job) }, "重试") : null
				))) : null
			);
		}

		/** 会话 → 课题归属查询（对话界面徽章/提示条共用）。
		 *  优先按会话绑定（launch 记录），否则按会话工作目录（cwd）匹配课题
		 *  workspacePath——同一课题空间内手动新建的每个对话都能识别课题。 */
		function useBoundProject(sessionId, call, useSessions) {
			const cwd = useSessions ? useSessions((s) => s.byId[sessionId]?.cwd) : undefined;
			const [bound, setBound] = useState(null);
			useEffect(() => {
				if (!sessionId) { setBound(null); return undefined; }
				let alive = true;
				const lookup = async () => {
					try {
						const bySession = await call("projects_by_session", { request: { sessionId } });
						if (bySession.bound) return bySession.bound;
						if (cwd) {
							const byCwd = await call("projects_by_cwd", { request: { path: cwd } });
							if (byCwd.bound) return byCwd.bound;
						}
						return null;
					} catch (reason) { return null; }
				};
				lookup().then((result) => { if (alive) setBound(result); });
				return () => { alive = false; };
			}, [sessionId, cwd, call]);
			return bound;
		}

		/** 会话头部课题身份卡：显示科研模式、当前课题与记忆版本。 */
		function ProjectBadge({ sessionId, call, openWorkspace, useSessions }) {
			const bound = useBoundProject(sessionId, call, useSessions);
			useEffect(() => {
				if (typeof document === "undefined" || !bound?.project?.id) return undefined;
				document.body.classList.add("ib-research-chat");
				document.body.dataset.ibResearchProject = bound.project.id;
				return () => {
					if (document.body.dataset.ibResearchProject === bound.project.id) {
						document.body.classList.remove("ib-research-chat");
						delete document.body.dataset.ibResearchProject;
					}
				};
			}, [bound?.project?.id]);
			if (!bound?.project) return null;
			return h("button", { className: "ib-research-badge", title: "打开课题空间", "aria-label": `打开课题空间：${bound.project.name}`, onClick: () => openWorkspace(bound.project) },
				h("span", { className: "ib-badge-icon" }, h(FlaskSvg, { width: 14, height: 14 })),
				h("span", { className: "ib-badge-copy" }, h("small", null, "Research workspace"), h("b", null, bound.project.name)),
				h("span", { className: "ib-badge-version" }, `记忆 v${bound.project.memoryVersion || "1"}`)
			);
		}

		function CreateProject({ call, defaults, onCancel, onCreated }) {
			const [form, setForm] = useState({ id: "", name: "", coreMarkdown: "# 核心课题\n\n## 研究问题\n\n## 核心假设\n\n## 预期目标\n\n## 当前进展\n- 项目建立" });
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState("");
			const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
			const create = async () => {
				setBusy(true); setError("");
				try {
					if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("项目编号请使用小写字母、数字和连字符，例如 polymer-prodrug-01");
					if (!form.name.trim()) throw new Error("请填写项目名称");
					if (!defaults.goal || !defaults.template) throw new Error("系统默认配置尚未就绪");
					const result = await call("projects_create", { request: { fields: { ...form, name: form.name.trim(), memoryChangeNote: "创建课题核心记忆", goalProfileId: defaults.goal.id, goalProfileVersion: defaults.goal.version, templateId: defaults.template.id, templateVersion: defaults.template.version } } });
					onCreated(result.project, result.presetId);
				} catch (reason) { setError(reason.message); } finally { setBusy(false); }
			};
			return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "建立新课题"), h("span", { className: "ib-chip" }, "从核心记忆开始")), h("div", { className: "ib-form-grid" }, h("div", { className: "ib-field" }, h("label", null, "项目编号（英文）"), h("input", { value: form.id, placeholder: "polymer-prodrug-01", onChange: field("id") })), h("div", { className: "ib-field" }, h("label", null, "项目名称"), h("input", { value: form.name, placeholder: "聚前药纳米递送课题", onChange: field("name") })), h("div", { className: "ib-field", "data-wide": true }, h("label", null, "核心课题 Markdown"), h("textarea", { value: form.coreMarkdown, onChange: field("coreMarkdown") }))), error ? h("div", { className: "ib-error" }, error) : null, h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void create() }, busy ? "创建中…" : "创建并进入")));
		}

		function Home({ call, onOpen, onLaunch, onOpenTemplates }) {
			const [state, setState] = useState({ loading: true, projects: [], defaults: {}, error: "" });
			const [creating, setCreating] = useState(false);
			const [launching, setLaunching] = useState(null);
			const load = useCallback(async () => {
				try {
					const [projects, goals, templates] = await Promise.all([call("projects_list"), call("goals_list"), call("templates_list")]);
					setState({ loading: false, projects: projects.projects || [], defaults: { goal: goals.goals.find((x) => x.id === "default-prodrug-polymer") || goals.goals[0], template: templates.templates.find((x) => x.id === "nature-default") || templates.templates[0] }, error: "" });
				} catch (reason) { setState({ loading: false, projects: [], defaults: {}, error: reason.message }); }
			}, []);
			useEffect(() => { void load(); }, [load]);
			const launch = async (project, presetId) => {
				setLaunching(project.id);
				try { await onLaunch(project, { presetId }); }
				catch (reason) { setState((previous) => ({ ...previous, error: reason.message })); setLaunching(null); }
			};
			return h("div", null, h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Research Projects"), h("h1", null, "选择一个课题继续"), h("p", null, "每个课题拥有独立的核心记忆、科研 Agent 对话和研究成果。创建课题后会自动打开专属工作区并开始科研 Agent 对话。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", onClick: onOpenTemplates }, "模板管理"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => setCreating(true) }, "+ 新建课题"))), creating ? h(CreateProject, { call, defaults: state.defaults, onCancel: () => setCreating(false), onCreated: (project, presetId) => void launch(project, presetId) }) : null, state.error ? h("div", { className: "ib-error" }, state.error) : null, state.loading ? h("div", { className: "ib-empty" }, "正在读取课题…") : state.projects.length ? h("div", { className: "ib-grid" }, state.projects.map((project) => h("button", { className: "ib-project", key: project.id, disabled: launching === project.id, onClick: () => onOpen(project) }, h("div", { className: "ib-project-icon" }, "PJ"), h("h2", null, project.name), h("p", null, launching === project.id ? "正在创建专属工作区并启动对话…" : "进入课题空间，继续对话、更新记忆或查询研究成果。"), h("div", { className: "ib-project-foot" }, h("span", null, `记忆 v${project.memoryVersion || "1"}`), h("span", null, when(project.updatedAt)))))) : h("div", { className: "ib-empty" }, "还没有课题。点击“新建课题”，先写下研究问题与目标。"));
		}

		/** bundle id → title 索引（精读条目缺省标题回退）。 */
		function bundleIndex(bundles = []) {
			const index = {};
			for (const bundle of bundles) index[bundle.id] = bundle.title;
			return index;
		}

		/** 文献管理两栏：左侧检索记录 + 右侧精读档案。 */
		function LitPanel({ searches, reports, bundles, presentations, call, notify, onOpenSearch, onChanged }) {
			const titleByBundle = bundleIndex(bundles);
			const presentationByReport = {};
			for (const item of (presentations || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
				if (!(item.reportId in presentationByReport)) presentationByReport[item.reportId] = item;
			}
			const [busy, setBusy] = useState({});
			const [overview, setOverview] = useState({});
			const [expandedSearch, setExpandedSearch] = useState(null);
			const [machineReviews, setMachineReviews] = useState({});
			const [preview, setPreview] = useState(null); // { kind: "report" | "ppt", report, presentation? }
			const [reviewVisible, setReviewVisible] = useState(false);
			const [approval, setApproval] = useState(null); // { stage: "confirm" | "approved", detail }
			const markBusy = (key, value) => setBusy((old) => ({ ...old, [key]: value }));
			const run = async (key, work) => {
				if (busy[key]) return;
				markBusy(key, true);
				try { await work(); }
				catch (reason) { notify(reason.message || "操作失败"); }
				finally { markBusy(key, false); }
			};
			const risFor = (search) => run(`ris:${search.id}`, async () => {
				const result = await call("tasks_search_ris", { request: { runId: search.id } });
				downloadText(result.ris.fileName, "application/x-research-info-systems;charset=utf-8", result.ris.text);
				notify(`已开始下载 ${result.ris.fileName}（${result.ris.count} 条文献）`);
			});
			const openOverview = (report) => run(`ov:${report.id}`, async () => {
				if (!(report.id in overview)) {
					const result = await call("tasks_overview", { request: { reportId: report.id } });
					setOverview((old) => ({ ...old, [report.id]: result.overview.summary }));
				} else {
					setOverview((old) => { const n = { ...old }; delete n[report.id]; return n; });
				}
			});
			const reviewPanel = (detail, title) => {
				if (!detail) return null;
				const findings = detail.findings || [];
				return h("div", { className: "ib-review-detail" },
					h("div", { className: "ib-review-detail-head" }, h("b", null, title), h("span", null, detail.ok ? "未发现明显问题" : "提醒项（不阻断审核）")),
					findings.length ? h("div", { className: "ib-review-findings" }, findings.map((finding, index) => h("div", { className: "ib-review-finding", "data-level": finding.level || finding.severity, key: `${finding.code || "item"}-${index}` }, h("i", null, finding.level || finding.severity || "info"), h("span", null, `${finding.code ? `${finding.code}：` : ""}${finding.message || ""}`)))) : h("div", { className: "ib-lit-note" }, detail.summary?.summary || "暂无结构化评审条目。")
				);
			};
			const reviewContext = (target = preview) => target?.kind === "ppt"
				? { key: `ppt:${target.presentation.id}`, request: { runId: target.presentation.id }, row: target.presentation }
				: { key: `report:${target.report.id}`, request: { reportId: target.report.id }, row: target?.report };
			const ensureMachineReview = async (target = preview) => {
				const context = reviewContext(target);
				if (machineReviews[context.key]) return machineReviews[context.key];
				let detail;
				try {
					const result = await call("tasks_review_details", { request: context.request });
					detail = result.review;
				} catch (reason) {
					// 自查不可用也不能变成人审门禁；把失败本身作为提醒展示。
					detail = { ok: false, findings: [{ level: "warning", code: "SELF_CHECK_UNAVAILABLE", message: reason.message || "自动自查详情暂时不可用，请以人工检查为准。" }] };
				}
				setMachineReviews((old) => ({ ...old, [context.key]: detail }));
				return detail;
			};
			const openPreview = (target) => { setPreview(target); setReviewVisible(false); setApproval(null); };
			const closePreview = () => { setPreview(null); setReviewVisible(false); setApproval(null); };
			const toggleMachineReview = () => {
				if (reviewVisible) { setReviewVisible(false); return; }
				const context = reviewContext();
				void run(`mr:${context.key}`, async () => { await ensureMachineReview(); setReviewVisible(true); });
			};
			const downloadReport = (report) => run(`rep:${report.id}`, async () => {
				const fileName = await downloadVerifiedBinary(`/api/lab-artifacts?kind=report&format=docx&reportId=${encodeURIComponent(report.id)}`);
				notify(`报告已开始下载：${fileName}`);
			});
			const downloadPpt = (report) => run(`ppt:${report.id}`, async () => {
				const fileName = await downloadVerifiedBinary(`/api/lab-artifacts?kind=ppt&reportId=${encodeURIComponent(report.id)}`);
				notify(`PPT 已开始下载：${fileName}`);
			});
			const rejectArtifact = () => {
				const context = reviewContext();
				void run(`reject:${context.key}`, async () => {
					const note = window.prompt(preview.kind === "ppt" ? "请输入 PPT 退回修改意见（可留空）：" : "请输入报告退回修改意见（可留空）：", "");
					if (note === null) return;
					if (preview.kind === "ppt") await call("tasks_presentation_review", { request: { fields: { runId: preview.presentation.id, decision: "rejected", note } } });
					else await call("tasks_report_review", { request: { fields: { reportId: preview.report.id, decision: "rejected", note } } });
					notify(preview.kind === "ppt" ? "文献 PPT 已退回修改" : "精读报告已退回修改");
					await onChanged();
					closePreview();
				});
			};
			const beginApproval = () => {
				const context = reviewContext();
				void run(`approve-check:${context.key}`, async () => {
					const detail = await ensureMachineReview();
					setReviewVisible(true);
					setApproval({ stage: "confirm", detail });
				});
			};
			const confirmApproval = () => {
				const target = preview;
				const context = reviewContext(target);
				void run(`approve:${context.key}`, async () => {
					let updated;
					if (target.kind === "ppt") {
						const result = await call("tasks_presentation_review", { request: { fields: { runId: target.presentation.id, decision: "approved", note: "已在预览页人工确认自查提醒与分页版式" } } });
						updated = result.run;
						setPreview((old) => old ? { ...old, presentation: updated } : old);
					} else {
						const result = await call("tasks_report_review", { request: { fields: { reportId: target.report.id, decision: "approved", note: "已在预览页人工确认自查提醒与分页版式" } } });
						updated = result.report;
						setPreview((old) => old ? { ...old, report: updated } : old);
					}
					setApproval((old) => ({ ...old, stage: "approved" }));
					notify(target.kind === "ppt" ? "文献 PPT 已人工审阅通过，可立即下载" : "精读报告已人工审阅通过，可立即下载");
					await onChanged();
				});
			};
			const parseJournalCitation = (...values) => {
				const pattern = /\*?([A-Z][A-Za-z.&' -]*?)\*?\s+(\d+[A-Za-z]?)\s*[,：:]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)\s*(?:\((\d{4})\)|,\s*(\d{4}))/g;
				for (const value of values) {
					const matches = [...String(value || "").matchAll(pattern)];
					const match = matches.at(-1);
					if (!match) continue;
					const journal = match[1].trim();
					const pages = match[3].replace(/\s*[-–—]\s*/g, "–");
					const suffix = ` ${match[2]}, ${pages} (${match[4] || match[5]}).`;
					return { journal, suffix, text: `${journal}${suffix}` };
				}
				return null;
			};
			const citationOf = (report) => parseJournalCitation(report.shortCitation, titleByBundle[report.bundleId]);
			const shortOf = (report) => citationOf(report)?.text || report.shortCitation || titleByBundle[report.bundleId] || `精读报告 ${report.id.slice(0, 12)}`;
			const shortNode = (report) => {
				const citation = citationOf(report);
				return citation ? h(React.Fragment, null, h("i", null, citation.journal), citation.suffix) : shortOf(report);
			};
			const zhOf = (report) => report.titleZh || shortOf(report);
			const paperCitation = (paper) => {
				const journal = paper.journal || paper.source || (paper.arxivId ? "arXiv" : "未知来源");
				const pages = paper.pages ? String(paper.pages).replace(/(\d)\s*-\s*(\d)/g, "$1–$2") : "";
				const bibliographic = `${paper.volume ? ` ${paper.volume}` : ""}${pages ? `${paper.volume ? ", " : " "}${pages}` : ""}${paper.year ? ` (${paper.year})` : ""}.`;
				const description = String(paper.shortDescriptionZh || "摘要待提炼").replace(/[（）()\s]/g, "").slice(0, 9);
				const target = paper.pdfUrl || paper.landingUrl || (paper.doi ? `https://doi.org/${paper.doi}` : undefined);
				return h("article", { className: "ib-search-paper", key: paper.doi || paper.pmid || paper.arxivId || paper.id || paper.title },
					h("div", { className: "ib-search-citation" }, h("i", null, journal), bibliographic, h("span", null, `（${description}）`), target ? h("a", { href: target, target: "_blank", rel: "noopener noreferrer", onClick: (event) => event.stopPropagation() }, paper.pdfUrl ? "PDF" : "原文") : null),
					h("small", { title: paper.title }, paper.title)
				);
			};
			const previewRow = preview?.kind === "ppt" ? preview?.presentation : preview?.report;
			const previewContext = preview ? reviewContext(preview) : null;
			const previewDetail = previewContext ? machineReviews[previewContext.key] : null;
			const previewApproved = previewRow?.review?.status === "approved";
			const downloadPreviewArtifact = () => preview?.kind === "ppt" ? downloadPpt(preview.report) : downloadReport(preview.report);
			const approvalNode = approval ? h("div", { className: "ib-approval-shade" },
				h("section", { className: "ib-approval-card", role: approval.stage === "approved" ? "status" : "alertdialog", "aria-label": approval.stage === "approved" ? "审核通过" : "审核通过二次确认" },
					approval.stage === "approved" ? h(React.Fragment, null,
						h("div", { className: "ib-approval-ok" }, h("strong", null, "审核通过"), h("span", null, `${preview?.kind === "ppt" ? "PPTX" : "DOCX"} 已开放下载；你也可以关闭此页面后继续在预览窗口下载。`)),
						h("div", { className: "ib-approval-actions" },
							h("button", { className: "ib-preview-btn", onClick: () => setApproval(null) }, "返回预览"),
							h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[preview?.kind === "ppt" ? `ppt:${preview?.report.id}` : `rep:${preview?.report.id}`], onClick: () => void downloadPreviewArtifact() }, preview?.kind === "ppt" ? "下载PPT" : "下载DOCX")
						)
					) : h(React.Fragment, null,
						h("h3", null, "审核通过前请确认自查提醒"),
						h("p", null, "自动自查仅供参考，不构成通过门限。请结合上方实际分页预览人工判断；点击确认后将锁定当前文件版本并开放下载。"),
						reviewPanel(approval.detail, preview?.kind === "ppt" ? "PPT 自动自查提醒" : "报告自动自查提醒"),
						h("div", { className: "ib-approval-actions" },
							h("button", { className: "ib-preview-btn", onClick: () => setApproval(null) }, "返回继续检查"),
							h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[`approve:${previewContext?.key}`], onClick: confirmApproval }, busy[`approve:${previewContext?.key}`] ? "提交中…" : "二次确认并通过")
						)
					)
				)
			) : null;
			const previewNode = preview ? h(React.Fragment, null,
				h("div", { className: "ib-preview-backdrop", onClick: closePreview }),
				h("aside", { className: "ib-preview-drawer", role: "dialog", "aria-modal": "true", "aria-label": preview.kind === "ppt" ? "PPT 人工审核预览" : "DOCX 人工审核预览" },
					h("div", { className: "ib-preview-head" },
						h("div", { className: "ib-preview-title" }, h("b", null, preview.kind === "ppt" ? `${shortOf(preview.report)} · 文献汇报 PPT` : `${shortOf(preview.report)} · 精读报告`), h("small", null, preview.kind === "ppt" ? "实际 PPTX 经 LibreOffice 渲染的分页预览" : "实际 DOCX 经 LibreOffice 渲染的分页预览")),
						h("span", { className: "ib-preview-state" }, statusOf(previewRow)),
						h("button", { className: "ib-preview-btn", onClick: closePreview, "aria-label": "关闭预览" }, "关闭")
					),
					h("iframe", { className: "ib-preview-frame", title: preview.kind === "ppt" ? "PPT 分页预览" : "Word 分页预览", src: `/api/lab-artifacts?preview=1&kind=${preview.kind === "ppt" ? "ppt" : "report"}&format=docx&reportId=${encodeURIComponent(preview.report.id)}&v=${encodeURIComponent(previewRow?.artifactSha256 || previewRow?.updatedAt || "current")}` }),
					reviewVisible ? h("div", { className: "ib-preview-review" }, reviewPanel(previewDetail, preview.kind === "ppt" ? "PPT 自动自查提醒（仅供参考）" : "报告自动自查提醒（仅供参考）")) : null,
					h("div", { className: "ib-preview-foot" },
						h("div", { className: "ib-preview-foot-note" }, previewRow?.status === "under-review" ? "请逐页检查内容与版式；审核通过时会先弹出自查提醒供二次确认。" : (previewApproved ? "该版本已人工审核通过，可在此直接下载原文件。" : "该版本已退回，Agent 修订并重新暂存后可再次审核。")),
						h("button", { className: "ib-preview-btn", disabled: busy[`mr:${previewContext?.key}`], onClick: toggleMachineReview }, busy[`mr:${previewContext?.key}`] ? "加载中…" : (reviewVisible ? "收起提醒" : "自查提醒")),
						h("button", { className: "ib-preview-btn", disabled: !previewApproved || busy[preview.kind === "ppt" ? `ppt:${preview.report.id}` : `rep:${preview.report.id}`], onClick: () => void downloadPreviewArtifact(), title: previewApproved ? "下载已人工审核的原文件" : "人工审核通过后开放下载" }, preview.kind === "ppt" ? "下载PPT" : "下载DOCX"),
						previewRow?.status === "under-review" ? h("button", { className: "ib-preview-btn", "data-danger": true, disabled: busy[`reject:${previewContext?.key}`], onClick: rejectArtifact }, "退回修改") : null,
						previewRow?.status === "under-review" ? h("button", { className: "ib-preview-btn", "data-primary": true, disabled: busy[`approve-check:${previewContext?.key}`], onClick: beginApproval }, busy[`approve-check:${previewContext?.key}`] ? "读取自查…" : "审核通过") : null
					),
					approvalNode
				)
			) : null;
			return h(React.Fragment, null, h("div", { className: "ib-lit" },
				// ── 左：文献检索 ──
				h("section", { className: "ib-lit-col" },
					h("div", { className: "ib-lit-head" }, h("h3", null, "文献检索"), h("small", null, `${searches.length} 条记录`)),
					h("div", { className: "ib-lit-note" }, "每个会话汇总为一个检索条目和一个 RIS；“检索”可展开本会话全部去重文献，点击条目可回到原对话。"),
					searches.length ? h("div", { className: "ib-lit-list" }, searches.slice().reverse().map((search) => h("div", { key: search.id },
						h("div", { className: "ib-lit-row", "data-clickable": search.sessionId ? "true" : undefined, onClick: search.sessionId ? () => onOpenSearch(search.sessionId) : undefined, title: search.sessionId ? "跳转到检索对话" : "该检索未记录会话" },
							h("div", { className: "ib-lit-main" }, h("b", null, search.title || search.query || search.id), h("small", null, `${(search.results || []).length} 篇 · ${(search.queries || [search.query]).filter(Boolean).length} 轮查询 · OA ${(search.results || []).filter((row) => row.isOa === true).length} · ${(search.sources || []).join("/") || "未知来源"}${(search.sourceFailures || []).length ? ` · ${search.sourceFailures.length} 个源降级` : ""} · ${when(search.updatedAt || search.createdAt)}`)),
							h("div", { className: "ib-lit-acts" },
								h("button", { className: "ib-lit-btn ok", disabled: !(search.results || []).length, onClick: (event) => { event.stopPropagation(); setExpandedSearch((value) => value === search.id ? null : search.id); } }, expandedSearch === search.id ? "收起" : "检索"),
								h("button", { className: "ib-lit-btn ok", disabled: busy[`ris:${search.id}`] || !(search.results || []).length, onClick: (event) => { event.stopPropagation(); void risFor(search); } }, busy[`ris:${search.id}`] ? "…" : ".ris")
							)
						),
						expandedSearch === search.id ? h("div", { className: "ib-search-results", role: "list", "aria-label": `${search.title || "检索"}的全部文献` }, (search.results || []).map(paperCitation)) : null
					))) : h("div", { className: "ib-lit-empty" }, "对话中的文献检索结果会按会话整理到这里。")
				),
				// ── 右：文献精读 ──
				h("section", { className: "ib-lit-col" },
					h("div", { className: "ib-lit-head" }, h("h3", null, "文献精读"), h("small", null, `${reports.length} 篇`)),
					h("div", { className: "ib-lit-note" }, "对话生成的 DOCX/PPTX 会自动暂存在条目中。先从右侧逐页预览并人工审核，通过后才开放原文件下载。"),
					reports.length ? h("div", { className: "ib-lit-list" }, reports.map((report) => {
						const presentation = presentationByReport[report.id];
						return h("div", { key: report.id, onClick: report.id in overview ? () => setOverview((old) => { const n = { ...old }; delete n[report.id]; return n; }) : undefined },
							h("div", { className: "ib-lit-row" },
								h("div", { className: "ib-lit-main" }, h("b", { title: zhOf(report) }, shortNode(report)), h("small", null, `${titleByBundle[report.bundleId] || "未登记原文"} · DOCX${report.review?.status === "approved" ? "已审核可下载" : (report.docxPath ? "已暂存待审核" : "生成中")} · 自查${report.audit?.ok ? "无明显问题" : "有提醒"}${presentation ? ` · PPT${presentation.review?.status === "approved" ? "已审核可下载" : (presentation.pptxPath ? "已暂存待审核" : "生成中")}` : ""} · ${when(report.createdAt)}`)),
								h("div", { className: "ib-lit-acts" },
									h("button", { className: "ib-lit-btn ok", disabled: busy[`ov:${report.id}`], onClick: () => void openOverview(report) }, busy[`ov:${report.id}`] ? "…" : (report.id in overview ? "收起概览" : "概览")),
									h("button", { className: "ib-lit-btn ok", disabled: !report.docxPath, onClick: () => openPreview({ kind: "report", report }), title: report.docxPath ? "打开报告预览、审核与下载" : "DOCX 尚未暂存" }, "报告"),
									h("button", { className: "ib-lit-btn ok", disabled: !presentation?.pptxPath, onClick: () => openPreview({ kind: "ppt", report, presentation }), title: presentation?.pptxPath ? "打开 PPT 预览、审核与下载" : "尚未生成或暂存 PPT" }, "PPT")
								)
							),
							report.id in overview ? h("div", { className: "ib-lit-overview" }, h("b", null, "文献概览（约 200 字）"), overview[report.id] ?? "加载中…") : null
						);
					})
					) : h("div", { className: "ib-lit-empty" }, "尚未暂存精读产物。对话完成报告生成并登记后，会自动出现在这里等待预览和人工审核。")
				)
			), previewNode);
		}

		function Project({ call, project, onBack, onStartChat, onOpenSearch }) {
			const [state, setState] = useState({ loading: true, data: null, error: "" });
			const [tab, setTab] = useState("literature");
			const [draft, setDraft] = useState("");
			const [note, setNote] = useState("");
			const [saving, setSaving] = useState(false);
			const [launching, setLaunching] = useState(false);
			const [toast, setToast] = useState("");
			const load = useCallback(async () => {
				try { const data = await call("projects_workspace", { request: { projectId: project.id } }); setState({ loading: false, data, error: "" }); setDraft(data.memory?.markdown || ""); }
				catch (reason) { setState({ loading: false, data: null, error: reason.message }); }
			}, [project.id]);
			useEffect(() => { void load(); }, [load]);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
			const save = async () => {
				setSaving(true);
				try { const result = await call("projects_memory_update", { request: { fields: { projectId: project.id, markdown: draft, changeNote: note } } }); setToast(`核心记忆已提交为 v${result.memory.version}`); setNote(""); await load(); }
				catch (reason) { setToast(reason.message); } finally { setSaving(false); }
			};
			const startChat = async () => {
				if (!state.data) return;
				setLaunching(true);
				try { await onStartChat(state.data.project, { memory: state.data.memory, presetId: state.data.presetId }); }
				catch (reason) { setToast(reason.message); setLaunching(false); }
			};
			if (state.loading) return h("div", { className: "ib-empty" }, "正在打开课题空间…");
			if (!state.data) return h("div", { className: "ib-empty" }, state.error, h("div", { style: { marginTop: 12 } }, h("button", { className: "ib-btn", onClick: onBack }, "返回")));
			const data = state.data;
			const literature = data.literature || {};
			const planning = data.planning || {};
			const characterization = data.characterization || {};
			const meta = { literature: ["文献资料", "左侧检索记录 · 右侧精读档案与下载"], planning: ["研究设计", "工作规划、实验方案与合成路线"], characterization: ["表征分析", "NMR 等结构表征和审核结果"] };
			return h("div", null,
				h("div", { className: "ib-project-head" }, h("button", { className: "ib-btn", onClick: onBack }, "← 所有课题"), h("div", { className: "ib-project-copy" }, h("h1", null, data.project.name), h("p", null, `项目编号 ${data.project.id} · 核心记忆 v${data.project.memoryVersion}`)), h("button", { className: "ib-btn ib-agent", "data-primary": true, disabled: launching, onClick: () => void startChat() }, h("span", { className: "ib-spark" }, "✦"), launching ? "正在启动…" : "开始科研 Agent 对话")),
				h("div", { className: "ib-memory" }, h("section", { className: "ib-card" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "课题核心记忆.md"), h("span", { className: "ib-chip" }, `当前 v${data.memory?.version || "—"}`)), h("textarea", { value: draft, spellCheck: false, onChange: (event) => setDraft(event.target.value) }), h("div", { className: "ib-save" }, h("input", { value: note, placeholder: "本次修改说明，例如：补充第二阶段实验结果", onChange: (event) => setNote(event.target.value) }), h("button", { className: "ib-btn", "data-primary": true, disabled: saving || draft === data.memory?.markdown, onClick: () => void save() }, saving ? "提交中…" : "提交新版本"))), h("aside", { className: "ib-card ib-help" }, h("strong", null, "这份 Markdown 有什么用？"), "它是该课题的长期核心记忆。开始科研 Agent 对话时，当前版本会自动放入 Harness 输入框。", h("div", { className: "ib-history" }, (data.memoryHistory || []).slice(0, 6).map((version) => h("div", { className: "ib-version", key: version.id }, h("span", null, h("b", null, `v${version.version}`), ` · ${version.changeNote}`), h("span", null, when(version.createdAt))))))),
				h("div", { className: "ib-tabs" }, Object.entries(meta).map(([id, copy]) => h("button", { className: "ib-tab", "data-active": tab === id ? "true" : undefined, key: id, onClick: () => setTab(id) }, h("strong", null, copy[0]), h("span", null, copy[1])))),
				h("section", { className: "ib-board" }, h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, meta[tab][0]), h("p", null, meta[tab][1])), h("button", { className: "ib-btn", onClick: () => void load() }, "刷新")), tab === "literature" ? h("div", null, h(DatabaseOverview, { call, notify: setToast }), h(FullTextDownloader, { call, notify: setToast }), h(LitPanel, { searches: literature.searches || [], reports: literature.reports || [], bundles: literature.bundles || [], presentations: literature.presentations || [], call, notify: setToast, onOpenSearch, onChanged: load })) : null, tab === "planning" ? h("div", { className: "ib-artifacts" }, h(Artifact, { title: "课题工作规划 / 实验方案", rows: planning.plans, empty: "让 Agent 制定阶段工作规划或实验方案。" }), h(Artifact, { title: "合成目标", rows: planning.targets, empty: "尚未登记合成目标。" }), h(Artifact, { title: "合成路线设计", rows: planning.routes, empty: "尚未形成合成路线。" })) : null, tab === "characterization" ? h("div", { className: "ib-artifacts" }, h(Artifact, { title: "NMR / 结构分析", rows: characterization.nmr, empty: "导入 NMR 或结构表征任务后会归档到这里。" }), h(Artifact, { title: "已审核结果", rows: (characterization.nmr || []).filter((row) => ["approved-written", "visually-verified"].includes(row.status)), empty: "尚无完成人工审核的表征结果。" })) : null),
				toast ? h("div", { className: "ib-toast" }, toast) : null
			);
		}

		/** 错误边界：overlay 内任何渲染期异常不卸载整棵根，而是显示错误提示并允许关闭/重试。 */
		class OverlayBoundary extends (React.Component ?? class {}) {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error: error && error.message ? error.message : String(error) };
			}
			componentDidCatch(error, info) {
				console.error("[dsh-lab-agent] overlay render error:", error, info);
			}
			render() {
				if (this.state.error) {
					return h("div", { className: "ib-overlay" }, h("section", { className: "ib-card", style: { maxWidth: 620, margin: "16vh auto", padding: 24 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "面板渲染出错"), h("span", { className: "ib-chip" }, "可重试或返回")), h("pre", { style: { whiteSpace: "pre-wrap", color: "#ffb4b4", background: "#0d2822", borderRadius: 10, padding: 12, fontSize: 10.5 } }, this.state.error), h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: () => this.props.onClose() }, "关闭"), h("button", { className: "ib-btn", "data-primary": true, onClick: () => this.setState({ error: null }) }, "重试"))));
				}
				return this.props.children;
			}
		}

		function Panel({ call, onClose, onStartChat, onOpenSearch, initial }) {			const [project, setProject] = useState(initial ?? null);
			const [templates, setTemplates] = useState(false);
			return ReactDOM.createPortal(h("div", { className: "ib-overlay" }, h("header", { className: "ib-top" }, h("div", { className: "ib-brand" }, h("div", { className: "ib-logo" }, "iB"), h("div", null, h("strong", null, "iBM Lab Agent"), h("small", null, "Project Research Workspace"))), h("div", { className: "ib-crumb" }, templates ? h("span", null, "模板 ", h("b", null, "管理")) : project ? h("span", null, "课题 / ", h("b", null, project.name)) : h("b", null, "我的科研课题")), h("button", { className: "ib-btn", onClick: onClose }, "返回 Harness")), h("main", { className: "ib-main" }, templates ? h(Templates, { call, onBack: () => setTemplates(false) }) : project ? h(Project, { call, project, onBack: () => setProject(null), onStartChat, onOpenSearch }) : h(Home, { call, onOpen: setProject, onLaunch: onStartChat, onOpenTemplates: () => setTemplates(true) }))), document.body);
		}

		/** 模板管理主视图：阅读笔记模板（Agent 生成阅读笔记时参考）+ PPT 模板（组会汇报用）。 */
		function Templates({ call, onBack }) {
			const [tab, setTab] = useState("notes");
			const [notes, setNotes] = useState({ loading: true, list: [], error: "" });
			const [ppt, setPpt] = useState({ loading: true, list: [], error: "" });
			const loadNotes = useCallback(async () => {
				setNotes((s) => ({ ...s, loading: true, error: "" }));
				try { const result = await call("note_templates_list"); setNotes({ loading: false, list: result.templates || [], error: "" }); }
				catch (reason) { setNotes((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message })); }
			}, [call]);
			const loadPpt = useCallback(async () => {
				setPpt((s) => ({ ...s, loading: true, error: "" }));
				try { const result = await call("templates_list"); setPpt({ loading: false, list: result.templates || [], error: "" }); }
				catch (reason) { setPpt((s) => ({ ...s, loading: false, list: s.list || [], error: reason.message })); }
			}, [call]);
			useEffect(() => { void loadNotes(); void loadPpt(); }, [loadNotes, loadPpt]);
			return h("div", null,
				h("div", { className: "ib-head" }, h("div", null, h("div", { className: "ib-kicker" }, "Template Library"), h("h1", null, "模板管理"), h("p", null, "管理「阅读笔记模板」与「PPT 模板」。科研 Agent 生成阅读笔记与汇报 PPT 时会按所选模板生成；任务保存版本快照，模板后续修改不影响旧产物。")), h("button", { className: "ib-btn", onClick: onBack }, "← 所有课题")),
				h("div", { className: "ib-tm-tabs" }, h("button", { className: "ib-tm-tab", "data-active": tab === "notes" ? "true" : undefined, onClick: () => setTab("notes") }, "阅读笔记模板"), h("button", { className: "ib-tm-tab", "data-active": tab === "ppt" ? "true" : undefined, onClick: () => setTab("ppt") }, "PPT 模板")),
				tab === "notes" ? h(NoteTemplates, { call, state: notes, reload: loadNotes }) : h(PptTemplates, { call, state: ppt, reload: loadPpt })
			);
		}

		/** 阅读笔记模板管理：列表 + 新建/编辑/复制/删除 + 查看要求。 */
		function NoteTemplates({ call, state, reload }) {
			const [mode, setMode] = useState("list"); // list | form
			const [editing, setEditing] = useState(null); // template row (null = 新建)
			const [busy, setBusy] = useState({});
			const [toast, setToast] = useState("");
			const [requirements, setRequirements] = useState(null);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
			const run = async (key, work) => {
				if (busy[key]) return;
				setBusy((old) => ({ ...old, [key]: true }));
				try { await work(); }
				catch (reason) { setToast(reason.message || "操作失败"); }
				finally { setBusy((old) => { const n = { ...old }; delete n[key]; return n; }); }
			};
			const remove = (row) => run(`del:${row.id}`, async () => {
				if (!window.confirm(`删除阅读笔记模板「${row.name}」？任务快照不受影响，历史版本仍可读。`)) return;
				await call("note_templates_delete", { request: { id: row.id } });
				setToast(`已删除模板「${row.name}」`); await reload(); setMode("list");
			});
			const showRequirements = (row) => run(`req:${row.id}`, async () => {
				if (requirements?.id === row.id) { setRequirements(null); return; }
				const result = await call("note_templates_requirements", { request: { id: row.id, version: row.version } });
				setRequirements({ id: row.id, name: row.name, data: result.requirements });
			});
			const openForm = (row, copy = false) => run("open", async () => {
				if (!row) { setEditing(null); setMode("form"); return; }
				const result = await call("note_templates_resolve", { request: { id: row.id, version: row.version } });
				setEditing(copy ? { ...result.template, _copy: true } : result.template);
				setMode("form");
			});
			if (mode === "form") return h(NoteTemplateForm, { call, initial: editing, onCancel: () => { setMode("list"); setEditing(null); }, onSaved: () => { setMode("list"); setEditing(null); void reload(); } });
			const cards = state.list.map((row) => h("div", { className: "ib-tm-card", key: row.id },
				h("div", { className: "ib-tm-title" }, h("b", null, row.name), h("span", null, `v${row.version} · ${when(row.updatedAt)}`)),
				h("div", { className: "ib-tm-sub" }, h("span", { className: "ib-key" }, row.id)),
				h("div", { className: "ib-tm-meta" }, (row.topics || []).slice(0, 3).map((t) => h("span", { className: "ib-tm-chip", key: t }, t)), (row.tags || []).slice(0, 3).map((t) => h("span", { className: "ib-tm-chip", "data-tone": "accent", key: t }, t))),
				h("div", { className: "ib-tm-acts" }, h("button", { className: "ib-lit-btn", onClick: () => openForm(row) }, "编辑"), h("button", { className: "ib-lit-btn", onClick: () => openForm(row, true) }, "复制"), h("button", { className: "ib-lit-btn", onClick: () => showRequirements(row) }, busy[`req:${row.id}`] ? "…" : (requirements?.id === row.id ? "收起要求" : "生成要求")), h("button", { className: "ib-lit-btn", onClick: () => remove(row) }, busy[`del:${row.id}`] ? "…" : "删除"))
			));
			const listBody = state.loading ? h("div", { className: "ib-empty" }, "正在读取模板…") : (state.list.length ? h("div", { className: "ib-tm-list" }, cards) : h("div", { className: "ib-empty" }, "还没有阅读笔记模板。点击“新建阅读笔记模板”创建，或直接使用内置默认模板 note-default。"));
			const reqPanel = requirements ? h("div", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `「${requirements.name}」参考要求`), h("span", { className: "ib-chip" }, "作为组织与格式参考")), h("pre", { style: { whiteSpace: "pre-wrap", fontSize: 10.5, lineHeight: 1.7, color: "#cfe3db", background: "#071611", border: "1px solid rgba(129,205,178,.12)", borderRadius: 10, padding: 12 } }, JSON.stringify(requirements.data, null, 2))) : null;
			return h("div", null,
				h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, "阅读笔记模板"), h("p", null, "Agent 生成阅读笔记时按模板章节与要求生成。这里可新建/复制/修改模板。")), h("button", { className: "ib-btn", "data-primary": true, onClick: () => openForm(null) }, "+ 新建阅读笔记模板")),
				state.error ? h("div", { className: "ib-error" }, state.error) : null,
				listBody,
				reqPanel,
				toast ? h("div", { className: "ib-toast" }, toast) : null
			);
		}

		/** 阅读笔记模板表单：新建（无 id）/ 编辑 / 复制（保留原 id 但可改名，复制时允许改 id）。 */
		function NoteTemplateForm({ call, initial, onCancel, onSaved }) {
			const blank = { id: "", name: "", audience: "课题组组会", language: "zh", length: "单篇 600-1000 字，突出与课题相关的关键内容", topics: [], tags: [], sections: [{ key: "citation", title: "文献信息", required: true, hint: "标题、作者、期刊、年份、DOI 的规范短引用" }, { key: "one-sentence-summary", title: "一句话概述", required: true, hint: "问题、做法、机制、成果各一短句" }], styleRules: [], evidenceRequirements: [], outputRequirements: [], remark: "" };
			const [form, setForm] = useState(() => initial ? cloneForm(initial) : cloneForm(blank));
			const [busy, setBusyTemp] = useState(false);
			const [error, setErrorTemp] = useState("");
			const isCreate = !initial;
			const isCopy = !!initial && initial._copy;
			const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
			const arrayField = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }));
			const listField = (key) => (event) => {
				const value = event.target.value;
				setForm((old) => ({ ...old, [key]: value === "" ? [] : value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }));
			};
			const setSection = (index, patch) => setForm((old) => ({ ...old, sections: (old.sections || []).map((s, i) => i === index ? { ...s, ...patch } : s) }));
			const addSection = () => setForm((old) => ({ ...old, sections: [...(old.sections || []), { key: "", title: "", required: true, hint: "" }] }));
			const removeSection = (index) => setForm((old) => ({ ...old, sections: (old.sections || []).filter((_, i) => i !== index) }));
			/** 「从 .md 导入」：整篇 Markdown 作为生成要求写入 outputRequirements，名称回退用文件名。 */
			const fileRef = useRef(null);
			const importFromMd = (event) => {
				const file = event.target.files?.[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					const text = String(reader.result || "");
					const nameFromFile = (file.name || "").replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
					setForm((old) => ({ ...old, name: old.name?.trim() ? old.name : nameFromFile, outputRequirements: text.split(/\r?\n/).map((s) => s.trimEnd()), remark: old.remark || `从文件导入：${file.name || ""}` }));
				};
				reader.onerror = () => setErrorTemp("读取 Markdown 文件失败");
				reader.readAsText(file);
				event.target.value = "";
			};
			const save = async () => {
				setBusyTemp(true); setErrorTemp("");
				try {
					if (!form.name.trim()) throw new Error("请填写模板名称");
					if (isCreate && !/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("模板编号请使用小写字母、数字和连字符，例如 lab-note-v2");
					const fields = { ...form, id: undefined };
					let payload;
					if (isCreate) payload = { id: form.id.trim(), fields };
					else if (isCopy) payload = { id: initial.id, newId: form.id.trim() || (form.name + "-copy"), name: form.name };
					else payload = { id: form.id, fields };
					const method = isCopy ? "note_templates_copy" : (isCreate ? "note_templates_create" : "note_templates_update");
					const result = await call(method, { request: isCopy ? payload : { id: payload.id, fields } });
					onSaved(result.template.name || form.name);
				} catch (reason) { setErrorTemp(reason.message); } finally { setBusyTemp(false); }
			};
			return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, isCopy ? "复制阅读笔记模板" : (isCreate ? "新建阅读笔记模板" : `编辑模板 v${form.version}`)), h("span", { className: "ib-chip" }, isCopy ? "origin " + initial.id : (isCreate ? "新模板" : `当前 v${form.version}`))),
				h("div", { className: "ib-req" },
					h("div", { className: "vertical-stack", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } }, h("button", { className: "ib-btn", onClick: () => fileRef.current && fileRef.current.click() }, "从 .md 文件导入"), h("input", { ref: fileRef, type: "file", accept: ".md,text/markdown,text/plain", style: { display: "none" }, onChange: importFromMd }), h("span", { style: { color: "#78958b", fontSize: 9.5 } }, "把一份 Markdown 整篇作为该模板的「生成要求」填入；不改变章节结构（按 needs 保留默认章节）。")),
					h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } },
						!isCopy && h("div", { className: "ib-req" }, h("label", null, "模板编号（英文小写）"), h("input", { value: form.id, disabled: !isCreate && !isCopy ? true : false, placeholder: "lab-note-v2", onChange: field("id") })),
						h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, placeholder: "聚前药精读笔记模板", onChange: field("name") })),
						h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })),
						h("div", { className: "ib-req" }, h("label", null, "语言"), h("select", { value: form.language, onChange: field("language") }, ["zh", "en", "zh-en"].map((l) => h("option", { value: l, key: l }, l)))),
						h("div", { className: "ib-req", style: { gridColumn: "1/-1" } }, h("label", null, "篇幅说明"), h("input", { value: form.length, onChange: field("length") })),
						h("div", { className: "ib-req" }, h("label", null, "适用课题（逗号分隔）"), h("input", { value: (form.topics || []).join(", "), onChange: listField("topics") })),
						h("div", { className: "ib-req" }, h("label", null, "标签（逗号分隔）"), h("input", { value: (form.tags || []).join(", "), onChange: listField("tags") }))
					),
					h("label", null, "章节结构（Agent 生成时按此章节组织笔记）"),
					h("div", { className: "ib-sections" }, (form.sections || []).map((s, index) => h("div", { className: "ib-section-row", key: index }, h("input", { type: "text", value: s.key, placeholder: "key", className: "ib-mini", onChange: (e) => setSection(index, { key: e.target.value }) }), h("input", { type: "text", value: s.title, placeholder: "章节标题", className: "ib-mini", onChange: (e) => setSection(index, { title: e.target.value }) }), h("input", { type: "text", value: s.hint, placeholder: "写作要点", className: "ib-mini", onChange: (e) => setSection(index, { hint: e.target.value }) }), h("input", { type: "checkbox", checked: !!s.required, title: "必填", onChange: (e) => setSection(index, { required: e.target.checked }) }), h("button", { className: "ib-mini ib-lit-btn", onClick: () => removeSection(index) }, "×"))), h("button", { className: "ib-mini ib-lit-btn", onClick: addSection }, "+ 加一节")),
					h("div", { className: "vertical-stack", style: { marginTop: 8, display: "grid", gap: 8, gridTemplateColumns: "repeat(2,1fr)" } },
						h("div", { className: "ib-req" }, h("label", null, "风格规则（每行一条）"), h("textarea", { value: (form.styleRules || []).join("\n"), onChange: arrayField("styleRules") })),
						h("div", { className: "ib-req" }, h("label", null, "证据与来源要求（每行一条）"), h("textarea", { value: (form.evidenceRequirements || []).join("\n"), onChange: arrayField("evidenceRequirements") })),
						h("div", { className: "ib-req" }, h("label", null, "附加输出要求（每行一条）"), h("textarea", { value: (form.outputRequirements || []).join("\n"), onChange: arrayField("outputRequirements") }))
					),
					error ? h("div", { className: "ib-error" }, error) : null,
					h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void save() }, busy ? "保存中…" : (isCopy ? "保存副本" : "保存")))
				)
			);
		}

		/** PPT 模板管理：模板用于格式参考，检查结果不参与产物人工审核门禁。 */
		function PptTemplates({ call, state, reload }) {
			const [mode, setMode] = useState("list"); // list | import
			const [selected, setSelected] = useState(null); // preview data
			const [meta, setMeta] = useState(null); // edit-meta form
			const [busy, setBusy] = useState({});
			const [toast, setToast] = useState("");
			const [validation, setValidation] = useState(null);
			useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);
			const run = async (key, work) => {
				if (busy[key]) return;
				setBusy((old) => ({ ...old, [key]: true }));
				try { await work(); }
				catch (reason) { setToast(reason.message || "操作失败"); }
				finally { setBusy((old) => { const n = { ...old }; delete n[key]; return n; }); }
			};
			const archive = (row) => run(`arc:${row.id}`, async () => {
				if (!window.confirm(`归档 PPT 模板「${row.name}」？历史版本仍可读，任务快照不受影响。`)) return;
				await call("templates_archive", { request: { id: row.id } });
				setToast(`已归档「${row.name}」`); await reload(); setSelected(null); setValidation(null);
			});
			const preview = (row) => run(`pv:${row.id}`, async () => {
				if (selected?.id === row.id) { setSelected(null); return; }
				const result = await call("templates_preview", { request: { id: row.id, version: row.version } });
				setSelected({ id: row.id, version: row.version, data: result.preview });
			});
			const doValidate = (row) => run(`vf:${row.id}`, async () => {
				const result = await call("templates_validate", { request: { id: row.id, version: row.version } });
				setValidation({ id: row.id, v: result.validation });
				setToast(result.validation.ok ? `模板「${row.name}」参考检查正常` : `模板「${row.name}」有格式提醒，但不阻止生成`);
			});
			const openMeta = (row) => run("meta", async () => {
				const result = await call("templates_resolve", { request: { id: row.id, version: row.version } });
				setMeta({ ...result.template });
			});
			const saveMeta = (fields) => run("save-meta", async () => {
				const result = await call("templates_update_meta", { request: { id: fields.id, fields: { name: fields.name, purpose: fields.purpose, audience: fields.audience, notesRequirement: fields.notesRequirement, maxPages: fields.maxPages ? Number(fields.maxPages) : undefined } } });
				setToast(`已更新「${result.template.name}」v${result.template.version}`); setMeta(null); await reload();
			});
			if (mode === "import") return h(PptTemplateImport, { call, onCancel: () => setMode("list"), onDone: (id) => { setToast(`已导入模板 ${id}，请确认映射后发布`); setMode("list"); void reload(); } });
			const statusLabel = (st) => ({ draft: "草稿", ready: "可用", archived: "已归档" }[st] || st);
			return h("div", null,
				h("div", { className: "ib-board-head" }, h("div", null, h("h2", null, "PPT 模板"), h("p", null, "模板只提供版式与风格参考；映射检查用于提示兼容性，不作为生成或人工审核门槛。")), h("div", { className: "ib-actions" }, h("button", { className: "ib-btn", "data-primary": true, onClick: () => setMode("import") }, "+ 导入 PPT 模板"))),
				state.error ? h("div", { className: "ib-error" }, state.error) : null,
				state.loading ? h("div", { className: "ib-empty" }, "正在读取模板…") : state.list.length ? h("div", { className: "ib-table" },
					h("div", { className: "ib-table-head" }, h("span", { className: "ib-tm-id" }, "ID"), h("span", { className: "ib-tm-name" }, "名称"), h("span", { className: "ib-tm-status" }, "状态"), h("span", { className: "ib-tm-actions" }, "操作")),
					state.list.map((row) => h("div", { className: "ib-table-row", key: row.id }, h("span", { className: "ib-tm-id ib-tm-key" }, row.id), h("span", { className: "ib-tm-name" }, h("b", null, row.name), h("small", { style: { display: "block", color: "#7fa396", fontSize: 9 } }, `v${row.version} · ${row.pageSize?.ratio || "?"} · ${when(row.updatedAt)}`)), h("span", { className: "ib-tm-status" }, h("span", { className: row.status === "ready" ? "ib-tm-chip" : "ib-tm-chip", "data-tone": row.status === "ready" ? "accent" : undefined }, statusLabel(row.status))), h("span", { className: "ib-tm-actions" }, h("button", { className: "ib-lit-btn", onClick: () => preview(row) }, busy[`pv:${row.id}`] ? "…" : (selected?.id === row.id ? "收起" : "预览")), h("button", { className: "ib-lit-btn", onClick: () => doValidate(row) }, busy[`vf:${row.id}`] ? "…" : "验证"), h("button", { className: "ib-lit-btn", onClick: () => openMeta(row) }, "编辑元数据"), h("button", { className: "ib-lit-btn", onClick: () => archive(row) }, busy[`arc:${row.id}`] ? "…" : "归档")))))
					: h("div", { className: "ib-empty" }, "还没有 PPT 模板。点击“导入 PPT 模板”上传 .pptx，或使用内置默认模板 nature-default。"),
				validation && validation.id ? h("div", { className: "ib-card ib-form", style: { marginTop: 14, borderColor: validation.v.ok ? "rgba(81,212,163,.4)" : "rgba(224,169,88,.45)" } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `格式参考检查`), h("span", { className: "ib-chip" }, validation.v.ok ? "正常" : "有提醒")), (validation.v.problems || []).length ? h("ul", { style: { color: validation.v.ok ? "#b4d9cc" : "#e9bd7d", fontSize: 10.5, lineHeight: 1.7, margin: 0, paddingLeft: 16 } }, validation.v.problems.map((p) => h("li", { key: p }, p))) : h("div", { className: "ib-sub" }, validation.v.natureDefault ? "内置默认模板（由 nature-paper2ppt 处理版式）" : "模板映射可作为生成时的版式参考。")) : null,
				selected ? h("div", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `角色映射预览`), h("span", { className: "ib-chip" }, `v${selected.version}`)), selected.data.natureDefault ? h("div", { className: "ib-sub" }, "内置默认模板：全部角色交由 nature-paper2ppt 默认流程处理。") : h("div", { className: "ib-table" }, h("div", { className: "ib-table-head" }, h("span", { style: { flex: 1 } }, "角色"), h("span", { style: { flex: 1 } }, "布局"), h("span", { style: { flex: 2 } }, "占位符")), selected.data.roles.map((role) => h("div", { className: "ib-table-row", key: role.role, style: { alignItems: "flex-start" } }, h("span", { className: "ib-tm-key", style: { flex: 1 } }, role.role), h("span", { style: { flex: 1, fontSize: 10 } }, `${role.layoutName || role.layoutId}`), h("span", { style: { flex: 2, fontSize: 9, color: "#7fa396" } }, (role.placeholders || []).map((p) => p.type).join(", ")))))) : null,
				meta ? h(MetaEditor, { call, initial: meta, onCancel: () => setMeta(null), onSaved: saveMeta }) : null,
				toast ? h("div", { className: "ib-toast" }, toast) : null
			);
		}

		/** 导入 .pptx → 解析 → 确认版式角色映射 → 发布。 */
		function PptTemplateImport({ call, onCancel, onDone }) {
			const [form, setForm] = useState({ id: "", name: "", audience: "课题组组会", purpose: "", file: null });
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState("");
			const [staged, setStaged] = useState(null); // { profile, parsed, suggestions }
			const [mapping, setMapping] = useState(null); // role → layoutId
			const field = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
			const readFile = (event) => {
				const file = event.target.files?.[0];
				if (!file) return;
				setForm((old) => ({ ...old, file }));
			};
			const toBase64 = (file) => new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => { const text = String(reader.result || ""); resolve(text.includes(",") ? text.split(",")[1] : text); };
				reader.onerror = () => reject(new Error("读取文件失败"));
				reader.readAsDataURL(file);
			});
			const doImport = async () => {
				setBusy(true); setError("");
				try {
					if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) throw new Error("模板编号请使用小写字母、数字和连字符，例如 lab-ppt-v3");
					if (!form.name.trim()) throw new Error("请填写模板名称");
					if (!form.file) throw new Error("请选择 .pptx 文件");
					const base64 = await toBase64(form.file);
					const result = await call("templates_import", { request: { id: form.id.trim(), name: form.name.trim(), base64, meta: { audience: form.audience, purpose: form.purpose } } });
					const profile = result.profile;
					const suggestions = result.suggestions || {};
					setStaged({ profile, parsed: result.parsed, suggestions });
					setMapping(Object.fromEntries(Object.entries(suggestions).map(([role, m]) => [role, m.layoutId])));
					setBusy(false);
				} catch (reason) { setError(reason.message); setBusy(false); }
			};
			const confirm = async () => {
				setBusy(true); setError("");
				try {
					const result = await call("templates_confirm", { request: { id: staged.profile.id, version: staged.profile.version, mapping: Object.fromEntries(Object.entries(mapping).map(([role, layoutId]) => [role, { layoutId }])) } });
					if (!result.ok) throw new Error(`模板映射无效：${(result.problems || []).join("；")}`);
					onDone(result.profile?.id || staged.profile.id);
				} catch (reason) { setError(reason.message); } finally { setBusy(false); }
			};
			if (!staged) {
				// 上传步骤
				return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, "导入 PPT 模板"), h("span", { className: "ib-chip" }, "先解析，再映射")),
					h("div", { className: "ib-req" }, h("div", { className: "ib-req" }, h("label", null, "模板编号（英文小写）"), h("input", { value: form.id, placeholder: "lab-ppt-v3", onChange: field("id") })), h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, placeholder: "课题组组会模板", onChange: field("name") })), h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })), h("div", { className: "ib-req" }, h("label", null, "用途"), h("input", { value: form.purpose, placeholder: "组会汇报 / 论文答辩", onChange: field("purpose") })), h("div", { className: "ib-req" }, h("label", null, ".pptx 文件"), h("input", { type: "file", accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation", onChange: readFile }))),
					error ? h("div", { className: "ib-error" }, error) : null,
					h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy || (!form.file || !form.id || !form.name), onClick: () => void doImport() }, busy ? "解析中…" : "解析并生成映射")));
			}
			// 已解析：确认每个版式角色 → 布局 → 发布
			const roles = staged.profile.layoutRoleMapping ? Object.keys(staged.profile.layoutRoleMapping) : [];
			const roleRows = roles.map((role) => h("div", { className: "ib-table-row", key: role },
				h("span", { className: "ib-tm-key", style: { flex: 1 } }, role),
				h("select", { style: { flex: 1, marginRight: 8 }, value: mapping[role] || "", onChange: (e) => setMapping((old) => ({ ...old, [role]: e.target.value })) }, (staged.parsed?.layouts || []).map((l) => h("option", { value: l.id, key: l.id }, `${l.name || l.id}（${(l.placeholders || []).map((p) => p.type).join("+") || "空"}）`))),
				h("span", { className: "ib-sub", style: { flex: 1 } }, (staged.suggestions && staged.suggestions[role] && staged.suggestions[role].reason) || "")
			));
			return h("section", { className: "ib-card ib-form" }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `确认「${staged.profile.name}」角色映射`), h("span", { className: "ib-chip" }, `${staged.parsed?.layoutCount || "?"} 个布局`)),
				h("div", { className: "ib-lit-note" }, "自动映射已按布局占位符特征生成，可逐角色调整；映射无效会明确拒绝并保持草稿状态，不会静默替换为默认模板。"),
				h("div", { className: "ib-table" }, [h("div", { className: "ib-table-head" }, h("span", { style: { flex: 1 } }, "角色"), h("span", { style: { flex: 1 } }, "布局"), h("span", { style: { flex: 1 } }, "说明")), ...roleRows]),
				error ? h("div", { className: "ib-error" }, error) : null,
				h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void confirm() }, busy ? "发布中…" : "确认映射并发布到可用")));
		}

		/** PPT 模板元数据编辑（名称/受众/用途/备注要求/最大页数）。 */
		function MetaEditor({ call, initial, onCancel, onSaved }) {
			const [form, setFormTemp] = useState({ name: initial.name || "", purpose: initial.purpose || "", audience: initial.audience || "", notesRequirement: initial.notesRequirement || "", maxPages: initial.maxPages ?? "" });
			const [busy, setBusyTemp] = useState(false);
			const [error, setErrorTemp] = useState("");
			const field = (key) => (event) => setFormTemp((old) => ({ ...old, [key]: event.target.value }));
			const save = async () => {
				setBusyTemp(true); setErrorTemp("");
				try {
					if (!form.name.trim()) throw new Error("请填写模板名称");
					await onSaved({ id: initial.id, ...form });
				} catch (reason) { setErrorTemp(reason.message); } finally { setBusyTemp(false); }
			};
			return h("section", { className: "ib-card ib-form", style: { marginTop: 14 } }, h("div", { className: "ib-card-head" }, h("span", { className: "ib-card-title" }, `编辑「${initial.id}」元数据`), h("span", { className: "ib-chip" }, `当前 v${initial.version}`)),
				h("div", { className: "ib-req", style: { display: "grid", gap: 8 } }, h("div", { className: "ib-req" }, h("label", null, "模板名称"), h("input", { value: form.name, onChange: field("name") })), h("div", { className: "ib-req" }, h("label", null, "受众"), h("input", { value: form.audience, onChange: field("audience") })), h("div", { className: "ib-req" }, h("label", null, "用途"), h("input", { value: form.purpose, onChange: field("purpose") })), h("div", { className: "ib-req" }, h("label", null, "备注/讲稿要求"), h("input", { value: form.notesRequirement, onChange: field("notesRequirement") })), h("div", { className: "ib-req" }, h("label", null, "最大页数"), h("input", { type: "number", value: form.maxPages, onChange: field("maxPages") }))),
				error ? h("div", { className: "ib-error" }, error) : null,
				h("div", { className: "ib-form-foot" }, h("button", { className: "ib-btn", onClick: onCancel }, "取消"), h("button", { className: "ib-btn", "data-primary": true, disabled: busy, onClick: () => void save() }, busy ? "保存中…" : "保存"))
			);
		}

		function Entry({ onOpen, wide }) { return h("button", { className: "ib-sidebar", onClick: onOpen, title: "打开课题工作台" }, h("span", { className: "ib-sidebar-logo" }, "iB"), wide ? h("span", null, "我的科研课题") : null); }

		/** 实验室烧瓶 SVG（配色与课题面板一致：绿色渐变主体 + 青色气泡）。 */
		function FlaskSvg({ width = 18, height = 18 }) {
			return h("svg", { viewBox: "0 0 24 24", fill: "none", width, height, "aria-hidden": "true" },
				h("path", { d: "M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3", stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }),
				h("path", { d: "M7 16h10l-2.4-3.4h-5.2L7 16Z", fill: "#eafff6", opacity: 0.9 }),
				h("circle", { cx: 12, cy: 13.2, r: 0.55, fill: "#73dce6" }),
				h("circle", { cx: 13.6, cy: 15, r: 0.4, fill: "#73dce6" })
			);
		}

		/**
		 * 品牌覆盖：sidebar 顶部原「DeepSeek HARNESS」wordmark 与鲸鱼 logo 由
		 * dsh-client-ui-sidebar 硬编码渲染，无 slot/配置可替换——这里用 CSS
		 * 隐藏原品牌，再注入自定义「烧瓶 + iBM Agent / based on DSH」元素。
		 * CSS modules 本地类名后缀（_logoRow/_brand/_railFish）在 sidebar 包内
		 * 稳定，升级后需复核。保留原按钮的"新建会话"点击行为。
		 */
		function applyBranding() {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
			const FLASK_HTML = '<svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><path d="M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16h10l-2.4-3.4h-5.2L7 16Z" fill="#eafff6" opacity="0.9"/><circle cx="12" cy="13.2" r="0.55" fill="#73dce6"/><circle cx="13.6" cy="15" r="0.4" fill="#73dce6"/></svg>';
			const FLASK_RAIL_HTML = FLASK_HTML.replace('width="18"', 'width="13"').replace('height="18"', 'height="13"');
			let observer = null;
			const hideNative = () => {
				const styleId = "dsh-lab-agent-brand";
				if (document.querySelector(`style[data-plugin-css="${styleId}"]`) !== null) return;
				const style = document.createElement("style");
				style.dataset.pluginCss = styleId;
				style.textContent = "[class*='_brand'] svg,[class*='_railFish']{display:none!important}";
				document.head.appendChild(style);
			};
			const inject = () => {
				hideNative();
				const row = document.querySelector("[class*='_logoRow']");
				if (!row) return false;
				let touched = false;
				// 宽栏：品牌按钮（_brand）内替换为 烧瓶 + iBM Agent
				const brand = row.querySelector("[class*='_brand']");
				if (brand && !brand.querySelector(".ib-brand-shell")) {
					const shell = document.createElement("span");
					shell.className = "ib-brand-shell";
					shell.setAttribute("data-dsh-lab-brand", "1");
					shell.innerHTML = `<span class="ib-brand-flask">${FLASK_HTML}</span><span class="ib-brand-text"><b>iBM Agent</b><small>based on DSH</small></span>`;
					brand.appendChild(shell);
					touched = true;
				}
				// 折叠栏：toggle 按钮内的鲸鱼（_railFish 兄弟）替换为 小烧瓶
				const toggle = row.querySelector("[class*='_toggle']");
				if (toggle && !toggle.querySelector(".ib-rail-flask")) {
					const flask = document.createElement("span");
					flask.className = "ib-rail-flask";
					flask.setAttribute("data-dsh-lab-brand", "1");
					flask.innerHTML = FLASK_RAIL_HTML;
					toggle.appendChild(flask);
					touched = true;
				}
				return touched;
			};
			// sidebar 由 React 渲染：注入一次成功后仍保持观察（折叠/展开会重渲染，
			// React 可能清掉注入元素），幂等补注；dispose 时统一断开。
			inject();
			let scheduled = false;
			const schedule = () => {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(() => { scheduled = false; inject(); });
			};
			observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true });
			return () => { if (observer) observer.disconnect(); };
		}

		function applyUi(ctx) {
			const call = async (method, args) => {
				const payload = args && typeof args === "object" && Object.keys(args).length === 1 && "request" in args ? args.request : args;
				const result = payload === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
				if (!result.ok) throw new Error(result.error?.message || result.error?.code || "remote call failed");
				return result.value;
			};
			let root = null;
			const close = () => { if (!root) return; const node = root; root = null; ReactDOM.unmountComponentAtNode(node); node.remove(); };
			const toast = (message) => {
				const node = document.createElement("div");
				node.className = "ib-toast";
				node.textContent = message;
				document.body.appendChild(node);
				setTimeout(() => node.remove(), 4500);
			};
			/**
			 * 会话开场提示。课题核心记忆已落盘到课题工作区 `项目记忆.md`
			 * （host 侧每次提交版本时同步重写）——开场只引导 agent 读取该文件，
			 * 不把整份记忆预填进输入框（避免输入框冗长、且记忆以文件为准）。
			 * 旧项目尚无文件时回退到面板返回的 memory 内容。
			 */
			const promptFor = (project, memory) => {
				const fileRef = `课题工作区里的「项目记忆.md」`;
				const lines = [
					`当前课题为「${project.name}」（项目编号：${project.id}）。`,
					`请先读取 ${fileRef}（课题工作区根目录，当前版本 v${memory?.version || project.memoryVersion || "?"}）了解课题背景，`
					+ "再开始工作；后续产物归档到这个项目。如发现信息冲突，先向我确认。",
					"",
					"开场请简短说明你已读取记忆、理解的课题背景，然后等待我的具体任务。"
				];
				if (!memory?.markdown && !project.workspacePath) {
					lines.splice(1, 0, "", `<!-- project-memory:${project.id}@${project.memoryVersion} -->`, memory?.markdown || `# ${project.name}`);
				}
				return lines.join("\n");
			};
			/**
			 * 为空白新会话选择科研 Agent 预设。wire 层返回 { result: { ok, error } }，
			 * **不会 throw**——必须检查 result.ok，否则预设切换失败会被静默吞掉。
			 * agent-preset-locked = 复用了已开始会话（预设已固定）：若该会话本就在
			 * 科研模式则无需处理，返回 "ok（沿用已有会话）"；否则返回失败说明。
			 * 返回 "ok" 或失败说明。
			 */
			const selectResearchPreset = async (sessionId, presetId) => {
				if (!presetId) return "ok（未配置科研预设，沿用会话默认）";
				try {
					const response = await ctx.connection.api.agentPresets.select({ sessionId, agentPreset: presetId });
					const result = response?.result ?? response;
					if (!result.ok) {
						const code = result.error?.code ?? "unknown";
						const detail = result.error?.message ?? "agentPresets.select 未返回 ok";
						if (code === "agent-preset-locked") {
							// 复用了已开始会话：预设已固定，无法中途切换（DSH 约束）。
							return `ok（复用已开始的会话，预设已固定，无法切换到 ${presetId}）`;
						}
						return `预设选择失败（${code}）：${detail}`;
					}
					return "ok";
				} catch (reason) {
					return `预设选择调用失败：${reason?.message ?? reason}`;
				}
			};
			/**
			 * 课题 launch：绑定是**工作区级**的——一个课题一个专属 workspace，
			 * 空间内所有对话共享课题标识与核心记忆。流程：复用或创建专属
			 * 工作区 → 在课题工作区里开启**新会话**（connectWorkspace 复用空白
			 * 会话或新建）→ 选择科研 Agent 预设（agentPresets.select，仅对
			 * 空白会话有效）→ 记录会话绑定 → 打开会话 → 把当前版本核心记忆
			 * 预填进输入框。旧项目（无 workspacePath）补建工作区，不沿用当前
			 * 会话。
			 */
			const launchProject = async (project, opts = {}) => {
				const presetId = opts.presetId;
				let sessionId;
				let workspaceId;
				let openedNew = false;
				let presetApplied = "ok";
				// 确保课题有专属目录 + 核心记忆文件「项目记忆.md」（幂等，旧项目补建）
				const ensured = await call("projects_ensure_workspace", { request: { projectId: project.id } });
				project = { ...project, workspacePath: ensured.path };
				const bound = (await call("projects_binding", { request: { projectId: project.id } })).binding ?? null;
				const wsSnapshot = ctx.workspaces.list.getSnapshot();
				const hasWorkspace = (id) => (wsSnapshot.items ?? []).some((item) => item.workspaceId === id);
				if (bound?.workspaceId && hasWorkspace(bound.workspaceId)) {
					// 已有课题工作区（仍存活）：在空间里开启新对话
					workspaceId = bound.workspaceId;
				} else {
					// 无工作区绑定，或绑定的工作区已被删除：注册课题工作区
					const ws = await ctx.workspaces.create({ path: project.workspacePath });
					if (!ws.ok) throw new Error(ws.error?.message || "创建课题工作区失败");
					workspaceId = ws.value.workspace.workspaceId;
					try { await ctx.workspaces.rename(workspaceId, project.name); } catch (reason) { console.warn("dsh-lab-agent: workspace rename failed", reason); }
					await call("projects_bind_workspace", { request: { projectId: project.id, workspaceId } });
				}
				// 在课题工作区开启新对话：connectWorkspace 复用该空间空白会话或新建
				sessionId = await ctx.workspaces.connectWorkspace(workspaceId);
				openedNew = true;
				presetApplied = await selectResearchPreset(sessionId, presetId);
				await call("projects_bind_session", { request: { projectId: project.id, sessionId, workspaceId } });
				ctx.sessions.open(sessionId);
				const actx = ctx.sessions.scope(sessionId);
				if (!actx) throw new Error("科研 Agent 会话尚未就绪，请稍后重试");
				const prompt = promptFor(project, opts.memory);
				ctx.conversation.input.for(actx).setDraft(prompt);
				close();
				if (presetApplied !== "ok") toast(`⚠️ ${presetApplied}`);
				return { sessionId, workspaceId, openedNew, presetApplied };
			};
			const open = (initial) => {
				if (root) return;
				root = document.createElement("div");
				document.body.appendChild(root);
				try {
					ReactDOM.render(h(OverlayBoundary, { onClose: close }, h(Panel, { call, onClose: close, onStartChat: launchProject, onOpenSearch: (sessionId) => { close(); try { ctx.sessions.open(sessionId); } catch (reason) { toast(reason.message || "无法打开该会话"); } }, initial: initial ?? null })), root);
				} catch (reason) {
					console.error("[dsh-lab-agent] overlay mount failed:", reason);
					close(); // 重置 root，避免侧边栏点击被残留节点短路
					toast(`面板加载失败：${reason?.message ?? reason}`);
				}
			};
			const openWorkspace = (project) => open(project);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "lab-panel", order: 5 }, (props) => h(Entry, { wide: props.wide, onOpen: () => open() })), "dsh-lab-agent: project entry");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: "lab-project-badge", order: 10 }, (props) => h(ProjectBadge, { ...props, call, openWorkspace })), "dsh-lab-agent: project badge");
			ctx.on("dispose", close);
		}

		async function apply(ctx) {
			await ctx.remote.$mount({ package: "dsh-lab-agent", descriptors });
			applyBranding();
			ctx.inject(["remote", "remote.lab", "slots", "sessions", "workspaces", "conversation", "connection"], applyUi);
		}
		exports.apply = apply;
		exports.inject = ["remote"];
		return module.exports;
	}
});
