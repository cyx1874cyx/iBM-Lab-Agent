/**
 * 原文批注层：文字选区 → 提问 → 自动落钉 → 短答卡片 → 编辑/重试/删除。
 *
 * 坐标全部相对页面归一化（0-1），图钉与高亮按当前页面尺寸换算；
 * 阅读器滚动、缩放、双栏切换时用 rAF/scroll 事件重算屏幕位置。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { h } from 'dsh-lab-agent/client-sdk';

const annotationStatusText = (item) => {
	if (item.status === 'pending') return '待生成';
	if (item.status === 'running') return '生成中…';
	if (item.status === 'failed') return '生成失败，可重试';
	return item.edited ? '已手动编辑' : '已回答';
};

const short = (value, max = 180) => {
	const text = String(value ?? '').replace(/\s+/g, ' ').trim();
	return text.length > max ? text.slice(0, max) + '…' : text;
};

export function ReaderAnnotations({ call, request, doc, flowRef, zoom, active, enabled }) {
	const [items, setItems] = useState([]);
	const [draft, setDraft] = useState(null);
	const [openId, setOpenId] = useState(null);
	const [editing, setEditing] = useState(null);
	const [error, setError] = useState('');
	const [tick, setTick] = useState(0);
	const [submitting, setSubmitting] = useState(false);
	const [flowReady, setFlowReady] = useState(false);
	const overlayRef = useRef(null);
	const aliveRef = useRef(true);
	aliveRef.current = true;
	const bump = useCallback(() => setTick((value) => value + 1), []);

	const refresh = useCallback(async () => {
		try {
			const result = await call('tasks_annotations_list', request);
			if (aliveRef.current) { setItems(result.items ?? []); setError(''); }
		} catch (reason) {
			if (aliveRef.current) setError(reason.message || String(reason));
		}
	}, [call, request.projectId, request.bundleId, request.kind]);

	useEffect(() => { void refresh(); }, [refresh]);

	const busy = items.some((item) => item.status === 'pending' || item.status === 'running');
	useEffect(() => {
		if (!busy) return undefined;
		const timer = setInterval(() => { void refresh(); }, 1300);
		return () => clearInterval(timer);
	}, [busy, refresh]);

	useEffect(() => {
		if (flowReady) return undefined;
		const timer = setInterval(() => { if (flowRef.current) setFlowReady(true); }, 200);
		return () => clearInterval(timer);
	}, [flowRef, flowReady]);

	useEffect(() => {
		const flow = flowRef.current;
		if (!flow) return undefined;
		const onScroll = () => bump();
		flow.addEventListener('scroll', onScroll, { passive: true });
		const observer = new ResizeObserver(bump);
		observer.observe(flow);
		window.addEventListener('resize', bump);
		return () => { flow.removeEventListener('scroll', onScroll); observer.disconnect(); window.removeEventListener('resize', bump); };
	}, [flowRef, bump, flowReady]);

	const pageElement = useCallback((page) => flowRef.current?.querySelector(`.page[data-page-number="${page}"]`), [flowRef]);

	const capture = useCallback(() => {
		if (!enabled || !active) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
		const pageEl = node?.closest?.('.page');
		if (!pageEl || !flowRef.current?.contains(pageEl)) return;
		const quote = selection.toString().replace(/\s+/g, ' ').trim();
		if (!quote) return;
		const pageRect = pageEl.getBoundingClientRect();
		if (!pageRect.width || !pageRect.height) return;
		const rects = [...range.getClientRects()]
			.map((rect) => ({
				x: Math.max(0, (rect.left - pageRect.left) / pageRect.width),
				y: Math.max(0, (rect.top - pageRect.top) / pageRect.height),
				w: Math.min(1, rect.width / pageRect.width),
				h: Math.min(1, rect.height / pageRect.height)
			}))
			.filter((rect) => rect.w > 0 && rect.h > 0);
		if (!rects.length) return;
		const last = rects[rects.length - 1];
		setDraft({
			page: Number(pageEl.dataset.pageNumber) || 1,
			rects,
			quote: quote.slice(0, 8000),
			pin: { x: Math.min(1, last.x + last.w), y: Math.min(1, last.y + last.h) },
			question: ''
		});
		setOpenId(null);
		setError('');
	}, [enabled, active, flowRef]);

	useEffect(() => {
		const flow = flowRef.current;
		if (!flow) return undefined;
		const onMouseUp = () => setTimeout(capture, 0);
		flow.addEventListener('mouseup', onMouseUp);
		return () => flow.removeEventListener('mouseup', onMouseUp);
	}, [flowRef, capture, flowReady]);

	useEffect(() => {
		if (!openId) return undefined;
		const onDown = (event) => {
			if (overlayRef.current?.contains(event.target)) return;
			setOpenId(null);
			setEditing(null);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [openId]);

	const pageTextFor = useCallback(async (page) => {
		try {
			const pdfPage = await doc?.getPage?.(page);
			const content = await pdfPage?.getTextContent?.();
			return (content?.items ?? []).map((item) => item.str ?? '').join(' ').slice(0, 15000);
		} catch { return ''; }
	}, [doc]);

	const submit = async () => {
		if (!draft || submitting) return;
		const question = draft.question.trim();
		if (!question) { setError('请填写问题'); return; }
		setSubmitting(true);
		setError('');
		try {
			const pageText = await pageTextFor(draft.page);
			const item = await call('tasks_annotations_create', {
				...request,
				page: draft.page,
				kind: 'text',
				rects: draft.rects,
				quote: draft.quote,
				pin: draft.pin,
				question,
				pageText
			});
			setItems((old) => [...old, item]);
			window.getSelection()?.removeAllRanges();
			setDraft(null);
			void refresh();
		} catch (reason) {
			setError(reason.message || String(reason));
		} finally {
			setSubmitting(false);
		}
	};

	const saveEdit = async (item) => {
		const value = editing?.value ?? '';
		try {
			const updated = await call('tasks_annotations_update', { ...request, annotationId: item.id, shortAnswer: value });
			setItems((old) => old.map((row) => row.id === item.id ? updated : row));
			setEditing(null);
		} catch (reason) { setError(reason.message || String(reason)); }
	};

	const retry = async (item) => {
		try {
			const pageText = await pageTextFor(item.page);
			const updated = await call('tasks_annotations_retry', { ...request, annotationId: item.id, pageText });
			setItems((old) => old.map((row) => row.id === item.id ? { ...row, ...updated, status: 'pending' } : row));
		} catch (reason) { setError(reason.message || String(reason)); }
	};

	const remove = async (item) => {
		if (!window.confirm('删除这条批注？问题和已有回答都会删除。')) return;
		try {
			await call('tasks_annotations_delete', { ...request, annotationId: item.id });
			setItems((old) => old.filter((row) => row.id !== item.id));
			setOpenId(null);
		} catch (reason) { setError(reason.message || String(reason)); }
	};

	const geometry = useMemo(() => {
		tick; zoom;
		const flow = flowRef.current;
		if (!flow) return null;
		const flowRect = flow.getBoundingClientRect();
		const pages = new Map();
		for (const pageEl of flow.querySelectorAll('.page[data-page-number]')) {
			pages.set(Number(pageEl.dataset.pageNumber), pageEl.getBoundingClientRect());
		}
		return { flowRect, pages };
	}, [tick, zoom, flowRef, items.length, doc, flowReady]);

	if (!enabled || !active || !doc || !flowReady || !geometry) return null;
	const { flowRect, pages } = geometry;
	const pagePoint = (page, point) => {
		const rect = pages.get(page);
		if (!rect) return null;
		return { left: rect.left - flowRect.left + point.x * rect.width, top: rect.top - flowRect.top + point.y * rect.height };
	};
	const overlayStyle = { position: 'fixed', left: flowRect.left, top: flowRect.top, width: flowRect.width, height: flowRect.height, pointerEvents: 'none', zIndex: 8 };
	const anchor = draft ? pagePoint(draft.page, draft.pin) : null;
	const open = openId ? items.find((item) => item.id === openId) : null;
	const openPoint = open?.pin ? pagePoint(open.page, open.pin) : null;

	return h('div', { ref: overlayRef, className: 'ib-anno-overlay', style: overlayStyle, 'data-annotations': true },
		items.map((item) => {
			const pin = item.pin ? pagePoint(item.page, item.pin) : null;
			if (!pin) return null;
			return h(React.Fragment, { key: item.id },
				(item.rects ?? []).map((rect, index) => {
					const left = flowRect && pages.get(item.page) ? pages.get(item.page).left - flowRect.left + rect.x * pages.get(item.page).width : 0;
					const top = pages.get(item.page) ? pages.get(item.page).top - flowRect.top + rect.y * pages.get(item.page).height : 0;
					return h('span', { key: index, className: 'ib-anno-highlight', 'data-status': item.status, style: { left, top, width: rect.w * pages.get(item.page).width, height: rect.h * pages.get(item.page).height } });
				}),
				h('button', {
					type: 'button',
					className: 'ib-anno-pin',
					'data-status': item.status,
					'data-open': openId === item.id ? 'true' : undefined,
					style: { left: pin.left, top: pin.top },
					title: item.question || item.quote,
					onClick: (event) => { event.stopPropagation(); setOpenId(item.id); setEditing(null); },
					onDoubleClick: (event) => { event.stopPropagation(); setOpenId(item.id); setEditing({ id: item.id, value: item.shortAnswer || item.modelAnswer || '' }); }
				}, item.status === 'pending' || item.status === 'running' ? h('span', { className: 'ib-reader-spinner' }) : null)
			);
		}),
		anchor ? h('div', { className: 'ib-anno-compose', style: { left: Math.max(8, Math.min(flowRect.width - 300, anchor.left)), top: Math.max(8, Math.min(flowRect.height - 170, anchor.top + 12)) } },
			h('div', { className: 'ib-anno-compose-quote' }, short(draft.quote, 120)),
			h('textarea', { autoFocus: true, rows: 3, placeholder: '就这段原文提问…', value: draft.question, onChange: (event) => setDraft({ ...draft, question: event.target.value }), onKeyDown: (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); } }),
			h('div', { className: 'ib-anno-compose-actions' },
				h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => { setDraft(null); window.getSelection()?.removeAllRanges(); } }, '取消'),
				h('button', { type: 'button', className: 'ib-anno-btn', 'data-primary': true, disabled: submitting, onClick: () => void submit() }, submitting ? '提交中…' : '提交'))
		) : null,
		open && openPoint ? h('div', { className: 'ib-anno-card', style: { left: Math.max(8, Math.min(flowRect.width - 340, openPoint.left + 12)), top: Math.max(8, Math.min(flowRect.height - 220, openPoint.top + 12)) }, onClick: (event) => event.stopPropagation() },
			h('div', { className: 'ib-anno-card-head' }, h('b', null, `第 ${open.page} 页`), h('span', { 'data-status': open.status }, annotationStatusText(open))),
			open.quote ? h('div', { className: 'ib-anno-card-quote' }, short(open.quote, 160)) : null,
			h('div', { className: 'ib-anno-card-question' }, open.question),
			editing?.id === open.id
				? h('div', null,
					h('textarea', { autoFocus: true, rows: 4, value: editing.value, onChange: (event) => setEditing({ id: open.id, value: event.target.value }) }),
					h('div', { className: 'ib-anno-card-actions' },
						h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => setEditing(null) }, '取消'),
						h('button', { type: 'button', className: 'ib-anno-btn', 'data-primary': true, onClick: () => void saveEdit(open) }, '保存')))
				: h('div', null,
					h('div', { className: 'ib-anno-card-answer' }, open.status === 'pending' || open.status === 'running' ? '正在根据原文生成短答…' : (open.shortAnswer || open.modelAnswer || '（暂无短答）')),
					(open.basis ?? []).length ? h('div', { className: 'ib-anno-card-basis' },
						h('div', null, '依据'),
						open.basis.map((row, index) => h('div', { key: index }, `第 ${row.page} 页：${short(row.quote, 120)}`))) : null,
					open.error ? h('div', { className: 'ib-anno-card-error' }, open.error) : null,
					h('div', { className: 'ib-anno-card-actions' },
						h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => setEditing({ id: open.id, value: open.shortAnswer || open.modelAnswer || '' }) }, '编辑'),
						open.status === 'failed' ? h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => void retry(open) }, '重试') : null,
						h('button', { type: 'button', className: 'ib-anno-btn', 'data-danger': true, onClick: () => void remove(open) }, '删除')))) : null,
		error ? h('div', { className: 'ib-anno-error' }, error) : null
	);
}

export const annotationStyles = `
.ib-anno-overlay{pointer-events:none}
.ib-anno-highlight{position:absolute;background:rgba(19,124,114,.16);outline:1px solid rgba(19,124,114,.35);border-radius:2px;pointer-events:none}
.ib-anno-highlight[data-status=failed]{background:rgba(175,51,51,.14);outline-color:rgba(175,51,51,.4)}
.ib-anno-pin{position:absolute;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;border:2px solid #fff;background:#137c72;color:#fff;cursor:pointer;pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;padding:0}
.ib-anno-pin::after{content:"";width:6px;height:6px;border-radius:50%;background:#fff}
.ib-anno-pin[data-status=pending],.ib-anno-pin[data-status=running]{background:#b5812f}
.ib-anno-pin[data-status=failed]{background:#af3333}
.ib-anno-pin[data-open=true]{box-shadow:0 0 0 3px rgba(19,124,114,.28)}
.ib-anno-pin .ib-reader-spinner{width:10px;height:10px;border-width:1.5px;border-color:#fff5;border-top-color:#fff;margin:0}
.ib-anno-compose,.ib-anno-card{position:absolute;pointer-events:auto;background:#fff;border:1px solid #d7dfe8;border-radius:8px;box-shadow:0 6px 24px rgba(21,45,66,.18);padding:8px;z-index:9;color:#303744;font:12px/1.5 system-ui,Segoe UI,Microsoft YaHei,sans-serif}
.ib-anno-compose{width:292px}.ib-anno-compose-quote{color:#607080;font-size:11px;margin-bottom:6px;max-height:34px;overflow:hidden}
.ib-anno-compose textarea,.ib-anno-card textarea{width:100%;box-sizing:border-box;border:1px solid #dce1e8;border-radius:6px;padding:6px;font:inherit;resize:vertical;color:#26313d}
.ib-anno-compose-actions,.ib-anno-card-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
.ib-anno-btn{border:1px solid #d6dee6;background:#fff;color:#40505f;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
.ib-anno-btn:hover{background:#f2f6f9}.ib-anno-btn[data-primary=true]{background:#137c72;border-color:#137c72;color:#fff}.ib-anno-btn[data-danger=true]{color:#af3333}
.ib-anno-card{width:332px;max-height:420px;overflow:auto}.ib-anno-card-head{display:flex;justify-content:space-between;gap:8px;color:#607080;font-size:11px;margin-bottom:6px}
.ib-anno-card-head span[data-status=running],.ib-anno-card-head span[data-status=pending]{color:#b5812f}.ib-anno-card-head span[data-status=failed]{color:#af3333}
.ib-anno-card-quote{border-left:3px solid #cfe0dc;background:#f6faf8;padding:5px 8px;color:#5c6a76;font-size:11px;margin-bottom:6px}
.ib-anno-card-question{font-weight:600;color:#1f3a3a;margin-bottom:6px}
.ib-anno-card-answer{background:#f7f9fb;border-radius:6px;padding:7px 8px;white-space:pre-wrap;color:#26313d;margin-bottom:6px}
.ib-anno-card-basis{font-size:11px;color:#607080;margin-bottom:4px}.ib-anno-card-basis>div:first-child{font-weight:600;color:#44586a;margin-bottom:2px}
.ib-anno-card-error{color:#af3333;font-size:11px;margin-top:4px}
.ib-anno-error{position:absolute;left:12px;bottom:12px;max-width:80%;pointer-events:auto;background:#fff0ee;color:#af3333;border:1px solid #f0c9c3;border-radius:6px;padding:4px 8px;font-size:11px}
`;
