// 品牌注入：侧栏 Logo、烧瓶图标、Hero 头像与原生品牌隐藏（从原 client/index.js 抽离）。
import { BRAND_ICON } from "./brand-icon.js";

export function applyBranding(onOpen) {
	if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
	const FLASK_HTML = '<svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><path d="M9 3h6M10 3v5.5L4.8 17.2A3 3 0 0 0 7.4 22h9.2a3 3 0 0 0 2.6-4.8L14 8.5V3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16h10l-2.4-3.4h-5.2L7 16Z" fill="#eafff6" opacity="0.9"/><circle cx="12" cy="13.2" r="0.55" fill="#73dce6"/><circle cx="13.6" cy="15" r="0.4" fill="#73dce6"/></svg>';
	const FLASK_RAIL_HTML = FLASK_HTML.replace('width="18"', 'width="13"').replace('height="18"', 'height="13"');
	const entries = new Set();
	const activate = (event) => {
		event.preventDefault();
		event.stopPropagation();
		onOpen();
	};
	const bindEntry = (node) => {
		if (!node || node.dataset.dshLabResearchEntry === "1") return;
		node.dataset.dshLabResearchEntry = "1";
		node.setAttribute("title", "打开科研课题");
		node.addEventListener("click", activate);
		entries.add(node);
	};
	let observer = null;
	const hideNative = () => {
		const styleId = "dsh-lab-agent-brand";
		let style = document.querySelector(`style[data-plugin-css="${styleId}"]`);
		if (style === null) {
			style = document.createElement("style");
			style.dataset.pluginCss = styleId;
			document.head.appendChild(style);
		}
		// 新版 sidebar 使用 railMark，旧版使用 railFish；二者都必须隐藏。
		// 宽栏同时隐藏原生品牌子树，只保留后注入的 ib-brand-shell。
		style.textContent = "[class*='_brand']>:not(.ib-brand-shell),[class*='_brand'] svg,[class*='_railMark'],[class*='_railFish']{display:none!important}";
	};
	const inject = () => {
		hideNative();
		let touched = false;
		const heroHeadline = document.querySelector("[class*='_headlineText']");
		if (heroHeadline && heroHeadline.textContent !== "专注源头创新") {
			heroHeadline.textContent = "专注源头创新";
			touched = true;
		}
		document.querySelectorAll("*").forEach((element) => {
			if (element.children.length === 0 && element.textContent?.trim() === "预览版") {
				element.remove();
				touched = true;
			}
		});
		const heroMarkHost = heroHeadline?.parentElement?.querySelector("[class*='_fishHitbox']");
		if (heroMarkHost && !heroMarkHost.querySelector(".ib-hero-avatar")) {
			const avatar = document.createElement("img");
			avatar.src = BRAND_ICON;
			avatar.alt = "";
			avatar.setAttribute("aria-hidden", "true");
			avatar.width = 34;
			avatar.height = 34;
			avatar.className = `${heroMarkHost.firstElementChild?.getAttribute("class") ?? ""} ib-hero-avatar`.trim();
			heroMarkHost.replaceChildren(avatar);
			touched = true;
		}
		const row = document.querySelector("[class*='_logoRow']");
		if (!row) return touched;
		// 宽栏：人像 Logo + iBM Agent，并把整个品牌按钮设为科研课题入口。
		const brand = row.querySelector("[class*='_brand']");
		if (brand && brand.dataset.dshLabResearchEntry !== "1") {
			bindEntry(brand);
			brand.setAttribute("aria-label", "打开科研课题");
			touched = true;
		}
		if (brand && !brand.querySelector(".ib-brand-shell")) {
			const shell = document.createElement("span");
			shell.className = "ib-brand-shell";
			shell.setAttribute("data-dsh-lab-brand", "1");
			shell.innerHTML = `<span class="ib-brand-avatar"><img src="${BRAND_ICON}" alt="" aria-hidden="true"></span><span class="ib-brand-text"><b>iBM Agent</b><small>based on DSH</small></span>`;
			brand.appendChild(shell);
			touched = true;
		}
		// 折叠栏：小烧瓶仅作为原生侧栏开关的图标，不另行绑定课题入口。
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
	return () => {
		if (observer) observer.disconnect();
		for (const node of entries) node.removeEventListener("click", activate);
		entries.clear();
	};
}
