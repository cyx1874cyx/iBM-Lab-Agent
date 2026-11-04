/**
 * 插件客户端 SDK（供各子插件的独立 bundle 在构建期导入）。
 *
 * 只放"跨 bundle 必须共用"的少量基建：注册表 + React 元素助手 + 项目级视图状态
 * + 两个无业务语义的浏览器工具。不含任何业务组件；插件若需要更多能力，
 * 应通过宿主 slots / remote 接口，而不是 import 母包内部实现。
 */
export { h } from "./h.js";
export { useProjectViewValue, useProjectViewScroll } from "./project-view-state.js";
export {
	registerWorkbenchModule,
	listWorkbenchModules,
	subscribeWorkbenchModules
} from "./module-registry.js";
export {
	registerProjectPanel,
	projectPanelFor,
	listProjectPanels
} from "./panel-registry.js";

// 共享 UI 套件：母包已实现的通用交互部件，插件只复用、不复制。
// 这些都不含业务逻辑（元素助手、图标、右键菜单、Ketcher 桥、桌面文件动作）。
export { KetcherEditorModal, StructureCard } from "./components-core.js";
export { ketcherRenderSmiles } from "./ketcher.js";
export { Templates as TemplateLibrary } from "./components-templates.js";
export { SpinSvg, BookSvg, SiSvg } from "./components-templates.js";
export { ReadingNoteSvg, OverviewSvg, TranslateSvg, PresentationSvg } from "./reading-action-icons.js";
export { EntryConversationButton, readingConversationId } from "./entry-conversation.js";
export { ReadingContextMenu } from "./reading-context-menu.js";
export { nativeArtifact } from "./desktop-client.js";
export { useReadingInteractions } from "./reading-interactions.js";
export { ReadingLinkUpload } from "./reading-link-upload.js";
// 打开右侧栏阅读器（PDF / 精读报告 / PPT）；LibreOffice 渲染由宿主工厂槽完成。
export { openReader, readerRuntime, readerPreferredMode, setReaderPreferredMode } from "./reader-host.js";

// 宿主能力：桌面/浏览器动作与文件下载。插件不应自己实现这些平台差异。
export {
	when, statusOf, saveRis, downloadVerifiedBinary, downloadOfficeArtifact,
	openOfficeArtifact, openPdfPreview, openExternalUrl, openInEdgeViaShell,
	webVpnStatusViaShell, iwanStatusViaShell, openWebVpnLoginViaShell,
	openWebVpnCaptureViaShell, showWebVpnViaShell, cancelWebVpnCaptureViaShell,
	revealSavedPathViaDesktop
} from "./lib.js";

/** 读取文件为 base64（不带 data: 前缀），与母包上传接口的编码约定一致。 */
export function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error(`无法读取文件：${file?.name ?? "未命名"}`));
		reader.onload = () => {
			const value = String(reader.result ?? "");
			const comma = value.indexOf(",");
			if (comma < 0) reject(new Error(`无法编码文件：${file?.name ?? "未命名"}`));
			else resolve(value.slice(comma + 1));
		};
		reader.readAsDataURL(file);
	});
}

/**
 * 注入插件自有样式（幂等：同 id 先移除旧节点）。
 * 返回清理函数；无 document 环境（Node 测试）时是 no-op。
 */
export function injectStyle(id, css) {
	if (typeof document === "undefined" || document.head === undefined) return () => {};
	const previous = document.getElementById(id);
	if (previous !== null) previous.remove();
	const style = document.createElement("style");
	style.id = id;
	style.textContent = String(css ?? "");
	document.head.appendChild(style);
	return () => { if (style.parentNode !== null) style.remove(); };
}
