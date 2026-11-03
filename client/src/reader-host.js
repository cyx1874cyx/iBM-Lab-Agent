/**
 * 阅读器宿主运行时：把 PDF 阅读绑定到课题会话与右侧栏。
 * 阅读器 UI 已迁入文献插件；母包只保留打开/翻译回调的桥。
 *
 * 运行时必须放在全局 Symbol 槽：母包与插件是两个独立 bundle，
 * 各自打包一份本模块，模块级变量不共享；宿主要写、插件要读。
 */
const PREFIX = 'dsh-resource://lab-reader/';
const HOST_KEY = Symbol.for('ibm.lab.reader-host');

function state() {
	if (globalThis[HOST_KEY] === undefined) globalThis[HOST_KEY] = { runtime: null };
	return globalThis[HOST_KEY];
}

export function setReaderRuntime(value) { state().runtime = value; }
export function readerRuntime() { return state().runtime; }
export function readerAddress({ projectId, bundleId, kind = 'pdf' }) { return PREFIX + [projectId, bundleId, kind].map(encodeURIComponent).join('/'); }
export async function openReader(request) {
	const runtime = state().runtime;
	if (!runtime) throw Error('侧栏阅读器尚未就绪');
	const address = readerAddress(request);
	await runtime.open(address, request);
	window.dispatchEvent(new CustomEvent('ibm-reader-open', { detail: { address } }));
}
