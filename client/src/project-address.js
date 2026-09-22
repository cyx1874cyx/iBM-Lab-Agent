// 课题资源 tab 的寻址规则。**不 import React**，因此可在 Node 里直接单测。
//
// 为什么用资源地址而不是页面地址：右侧栏的页面 tab 身份只由 kind 决定
// （`pageAddress(kind) = sidebar://<kind>`，`params` 完全不参与身份），所以一个 kind 只能
// 有一个页面 tab。资源 tab 的 contentId 就是地址本身，于是 <前缀><projectId> 天然做到
// 「每课题一标签、切课题不串台」。完整论证见
// docs/PROJECT_AS_SIDEBAR_TAB_EVALUATION.md。

/** tab 类型身份：同时是 sidebar.right.pane.tab / .title 座位上的派发 key。 */
export const PROJECT_TAB_ID = "dsh-lab-agent/project";
/** 资源类型的 kind。资源按地址认领，kind 只用于区分实现，不用于 openTab。 */
export const PROJECT_TAB_KIND = "lab-project";
/** 资源地址前缀。 */
export const PROJECT_ADDRESS_PREFIX = "dsh-resource://lab-project/";
/**
 * 认领模式。含 `":"` → 右侧栏的 router 把它按**整条地址**用 picomatch 匹配
 * （见 sidebar-right 的 matcherFor），已实测命中 `dsh-resource://lab-project/proj-1`
 * 且不命中 `dsh-resource://file/...`。
 */
export const PROJECT_PATTERNS = ["dsh-resource://lab-project/**"];

/** 课题 id → 资源地址。 */
export const projectAddress = (projectId) => `${PROJECT_ADDRESS_PREFIX}${encodeURIComponent(String(projectId ?? ""))}`;

/**
 * 资源地址 → 课题 id。
 * @returns 不是本类型的地址、空 id、或百分号编码损坏时返回 undefined。
 */
export function projectIdOf(address) {
	const raw = String(address ?? "");
	if (!raw.startsWith(PROJECT_ADDRESS_PREFIX)) return undefined;
	try {
		// decodeURIComponent 对 "%zz" 这类输入会抛错；坏地址按「不是本类型」处理。
		const id = decodeURIComponent(raw.slice(PROJECT_ADDRESS_PREFIX.length));
		return id || undefined;
	} catch {
		return undefined;
	}
}
