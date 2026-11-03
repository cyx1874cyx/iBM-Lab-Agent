/**
 * 阅读器宿主运行时：把 PDF 阅读绑定到课题会话与右侧栏。
 * 阅读器 UI 已迁入文献插件；母包只保留打开/翻译回调的桥。
 */
const PREFIX = 'dsh-resource://lab-reader/';
let runtime = null;
export function setReaderRuntime(value) { runtime = value; }
export function readerRuntime() { return runtime; }
export function readerAddress({ projectId, bundleId, kind = 'pdf' }) { return PREFIX + [projectId, bundleId, kind].map(encodeURIComponent).join('/'); }
export async function openReader(request) {
	if (!runtime) throw Error('侧栏阅读器尚未就绪');
	const address = readerAddress(request);
	await runtime.open(address, request);
	window.dispatchEvent(new CustomEvent('ibm-reader-open', { detail: { address } }));
}
