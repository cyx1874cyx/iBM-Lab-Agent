/**
 * 原文批注层：文字选区 → 提问 → 自动落钉 → 短答卡片 → 编辑/重试/删除。
 *
 * 坐标全部相对页面归一化（0-1），图钉与高亮按当前页面尺寸换算；
 * 阅读器滚动、缩放、双栏切换时用 rAF/scroll 事件重算屏幕位置。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
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

export function ReaderAnnotations({ call, request, doc, flowRef, zoom, active, enabled, hand = false, regionMode = false, openTocSignal = 0, marginHost = null, leaderHost = null, page = 1, onRegionDone }) {
	const [items, setItems] = useState([]);
	const [draft, setDraft] = useState(null);
	const [openId, setOpenId] = useState(null);
	const openItemRef = useRef(null);
	const [editing, setEditing] = useState(null);
	const [error, setError] = useState('');
	const [tick, setTick] = useState(0);
	const [submitting, setSubmitting] = useState(false);
	const [flowReady, setFlowReady] = useState(false);
	const [followText, setFollowText] = useState('');
	const [tocOpen, setTocOpen] = useState(false);
	const frameRef = useRef(0);
	const scrollTimerRef = useRef(0);
	const overlayRef = useRef(null);
	const contentRef = useRef(null);
	const cardLayerRef = useRef(null);
	const panelCardRef = useRef(null);
	const questionRef = useRef(null);
	const aliveRef = useRef(true);
	aliveRef.current = true;
	const bump = useCallback(() => {
		if (frameRef.current) return;
		frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; setTick((value) => value + 1); });
	}, []);

	useEffect(() => { if (openTocSignal) setTocOpen(true); }, [openTocSignal]);

	useEffect(() => {
		const host = leaderHost;
		if (!host) return undefined;
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('class', 'ib-anno-leader');
		svg.setAttribute('preserveAspectRatio', 'none');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', '#2f7f74');
		path.setAttribute('stroke-width', '1.4');
		path.setAttribute('stroke-linejoin', 'round');
		svg.append(path);
		host.append(svg);
		return () => { svg.remove(); };
	}, [leaderHost]);

	const alignLeader = useCallback(() => {
		const host = leaderHost;
		const svg = host?.querySelector('.ib-anno-leader');
		const path = svg?.querySelector('path');
		const card = panelCardRef.current;
		const item = openItemRef.current ?? items.find((row) => row.id === openId);
		const flow = flowRef.current;
		const body = host?.parentElement;
		if (!svg || !path || !card || !item?.pin || !flow || !body || !marginHost) { if (svg) svg.style.display = 'none'; return; }
		const pageEl = flowRef.current?.querySelector(`.page[data-page-number="${item.page}"]`);
		if (!pageEl) { svg.style.display = 'none'; return; }
		const pageRect = pageEl.getBoundingClientRect();
		const bodyRect = body.getBoundingClientRect();
		const marginRect = marginHost.getBoundingClientRect();
		svg.setAttribute('width', String(Math.round(bodyRect.width)));
		svg.setAttribute('height', String(Math.round(bodyRect.height)));
		svg.setAttribute('viewBox', `0 0 ${Math.round(bodyRect.width)} ${Math.round(bodyRect.height)}`);
		const head = marginHost.querySelector('.ib-anno-panel-head');
		const tabs = marginHost.querySelector('.ib-anno-panel-tabs');
		const minTop = (head?.offsetHeight ?? 0) + (tabs?.offsetHeight ?? 0) + 26;
		const cardHeight = card.offsetHeight;
		const panelTop = marginRect.top - bodyRect.top;
		const pinY = pageRect.top + item.pin.y * pageRect.height - bodyRect.top;
		const top = Math.max(minTop, Math.min(marginRect.height - cardHeight - 12, pinY - panelTop - cardHeight / 2));
		card.style.top = `${top}px`;
		const startX = pageRect.left + item.pin.x * pageRect.width - bodyRect.left;
		const startY = pinY;
		const endX = marginRect.left - bodyRect.left + 14;
		const endY = panelTop + top + Math.min(cardHeight / 2, 70);
		const bend = Math.max(24, (endX - startX) * 0.45);
		path.setAttribute('d', `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - 36} ${endY}, ${endX} ${endY}`);
		svg.style.display = 'block';
	}, [flowRef, leaderHost, marginHost, items, openId]);

	useEffect(() => {
		const frame = requestAnimationFrame(alignLeader);
		return () => cancelAnimationFrame(frame);
	}, [alignLeader, openId, items, tick]);

	useEffect(() => {
		const card = panelCardRef.current;
		if (!card) return undefined;
		const observer = new ResizeObserver(() => alignLeader());
		observer.observe(card);
		return () => observer.disconnect();
	}, [alignLeader, openId]);

	useEffect(() => {
		const flow = flowRef.current;
		if (!flow) return undefined;
		let frame = 0;
		const update = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; alignLeader(); }); };
		flow.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		return () => { if (frame) cancelAnimationFrame(frame); flow.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
	}, [flowRef, alignLeader]);

	useEffect(() => {
		if (openId || !items.length) return;
		const current = items.find((item) => item.page === page);
		const chosen = current ?? items[0];
		openItemRef.current = chosen;
		setOpenId(chosen.id);
	}, [items, openId, page]);

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
		const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 2000);
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
		// 滚动只平移内层内容，不触发 React 重渲染，避免与 PDF.js 渲染争抢主线程。
		const onScroll = () => {
			const target = contentRef.current;
			if (target) target.style.transform = `translate(${-flow.scrollLeft}px, ${-flow.scrollTop}px)`;
			const cardLayer = cardLayerRef.current;
			if (cardLayer) cardLayer.style.transform = `translate(${-flow.scrollLeft}px, ${-flow.scrollTop}px)`;
			// 卡片仍钉在页面原位，但批注离开可视区域一个屏高后自动收起。
			const item = openItemRef.current;
			if (item?.pin) {
				const pageEl = flow.querySelector(`.page[data-page-number="${item.page}"]`);
				if (pageEl) {
					const pageRect = pageEl.getBoundingClientRect();
					const flowRect = flow.getBoundingClientRect();
					const y = pageRect.top - flowRect.top + item.pin.y * pageRect.height;
					const margin = flow.clientHeight;
					if (y < -margin || y > flowRect.height + margin) {
						openItemRef.current = null;
						setOpenId(null);
						setEditing(null);
					}
				}
			}
		};
		onScroll();
		flow.addEventListener('scroll', onScroll, { passive: true });
		const observer = new ResizeObserver(bump);
		observer.observe(flow);
		const viewer = flow.querySelector('.pdfViewer');
		const mutation = viewer ? new MutationObserver(bump) : null;
		if (viewer && mutation) mutation.observe(viewer, { childList: true, subtree: false });
		window.addEventListener('resize', bump);
		return () => { flow.removeEventListener('scroll', onScroll); observer.disconnect(); mutation?.disconnect(); window.removeEventListener('resize', bump); };
	}, [flowRef, bump, flowReady]);

	useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); clearTimeout(scrollTimerRef.current); }, []);

	const pageElement = useCallback((page) => flowRef.current?.querySelector(`.page[data-page-number="${page}"]`), [flowRef]);

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

	useEffect(() => {
		const flow = flowRef.current;
		if (!flow || !regionMode || !active || !enabled) return undefined;
		const rubber = document.createElement('div');
		rubber.className = 'ib-anno-rubber';
		rubber.style.display = 'none';
		flow.append(rubber);
		flow.dataset.region = 'true';
		const previousSelect = flow.style.userSelect;
		const previousCursor = flow.style.cursor;
		flow.style.userSelect = 'none';
		flow.style.cursor = 'crosshair';
		let start = null;
		const point = (event, pageRect) => ({
			x: Math.min(1, Math.max(0, (event.clientX - pageRect.left) / pageRect.width)),
			y: Math.min(1, Math.max(0, (event.clientY - pageRect.top) / pageRect.height))
		});
		const draw = (event) => {
			if (!start) return;
			const { pageEl, pageRect } = start;
			const current = point(event, pageRect);
			const x = Math.min(start.x, current.x), y = Math.min(start.y, current.y);
			const flowRect = flow.getBoundingClientRect();
			const left = pageRect.left - flowRect.left + flow.scrollLeft + x * pageRect.width;
			const top = pageRect.top - flowRect.top + flow.scrollTop + y * pageRect.height;
			rubber.style.display = 'block';
			rubber.style.left = `${left}px`;
			rubber.style.top = `${top}px`;
			rubber.style.width = `${Math.abs(current.x - start.x) * pageRect.width}px`;
			rubber.style.height = `${Math.abs(current.y - start.y) * pageRect.height}px`;
			start.current = current;
		};
		const down = (event) => {
			if (event.button !== 0 || event.detail > 1) return;
			const pageEl = event.target?.closest?.('.page');
			if (!pageEl || !flow.contains(pageEl)) return;
			event.preventDefault();
			const pageRect = pageEl.getBoundingClientRect();
			start = { pageEl, pageRect, x: point(event, pageRect).x, y: point(event, pageRect).y, px: event.clientX, py: event.clientY };
			start.x = point(event, pageRect).x;
			start.y = point(event, pageRect).y;
			draw(event);
		};
		const move = (event) => { if (start) draw(event); };
		const up = async (event) => {
			if (!start) return;
			const { pageEl, pageRect } = start;
			const current = point(event, pageRect);
			const rect = { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y) };
			const moved = Math.hypot(event.clientX - start.px, event.clientY - start.py);
			start = null;
			rubber.remove();
			if (moved < 10 || rect.w * pageRect.width < 12 || rect.h * pageRect.height < 12) return;
			let cropBase64 = '';
			try {
				const canvas = pageEl.querySelector('canvas');
				if (canvas) {
					const sx = rect.x * canvas.width, sy = rect.y * canvas.height, sw = rect.w * canvas.width, sh = rect.h * canvas.height;
					if (sw >= 1 && sh >= 1) {
						const out = document.createElement('canvas');
						out.width = Math.max(1, Math.round(sw));
						out.height = Math.max(1, Math.round(sh));
						out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
						cropBase64 = out.toDataURL('image/png').split(',')[1] || '';
					}
				}
			} catch { cropBase64 = ''; }
			const flowRect = flow.getBoundingClientRect();
			setDraft({ page: Number(pageEl.dataset.pageNumber) || 1, rects: [rect], quote: '', pin: { x: rect.x + rect.w, y: rect.y + rect.h }, question: '', kind: 'region', cropBase64, screen: { left: pageRect.left - flowRect.left + rect.x * pageRect.width, top: pageRect.top - flowRect.top + rect.y * pageRect.height } });
			setOpenId(null);
			onRegionDone?.();
		};
		flow.addEventListener('pointerdown', down);
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		return () => {
			flow.removeEventListener('pointerdown', down);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			flow.style.userSelect = previousSelect;
			flow.style.cursor = previousCursor;
			delete flow.dataset.region;
			rubber.remove();
		};
	}, [flowRef, regionMode, active, enabled, onRegionDone]);

	// 直接在图片/图表上拖矩形：不需要先进入框选模式，也不需要选中文字。
	useEffect(() => {
		const flow = flowRef.current;
		if (!flow || !enabled || !active || regionMode || hand) return undefined;
		let start = null;
		const rubber = document.createElement('div');
		rubber.className = 'ib-anno-rubber';
		rubber.style.display = 'none';
		flow.append(rubber);
		const drawRubber = (event) => {
			if (!start) return;
			const { pageRect } = start;
			const flowRect = flow.getBoundingClientRect();
			const x = Math.min(start.x, event.clientX), y = Math.min(start.y, event.clientY);
			rubber.style.display = 'block';
			rubber.style.left = `${x - flowRect.left + flow.scrollLeft}px`;
			rubber.style.top = `${y - flowRect.top + flow.scrollTop}px`;
			rubber.style.width = `${Math.abs(event.clientX - start.x)}px`;
			rubber.style.height = `${Math.abs(event.clientY - start.y)}px`;
		};
		const down = (event) => {
			if (event.button !== 0 || event.detail > 1) return;
			const pageEl = event.target?.closest?.('.page');
			if (!pageEl || !flow.contains(pageEl)) return;
			start = { pageEl, pageRect: pageEl.getBoundingClientRect(), x: event.clientX, y: event.clientY };
		};
		const move = (event) => { if (start) drawRubber(event); };
		const up = async (event) => {
			if (!start) return;
			const current = start;
			start = null;
			rubber.remove();
			const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y);
			if (moved < 10) return;
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed && String(selection).trim()) return;
			const { pageEl, pageRect } = current;
			const point = (x, y) => ({ x: Math.min(1, Math.max(0, (x - pageRect.left) / pageRect.width)), y: Math.min(1, Math.max(0, (y - pageRect.top) / pageRect.height)) });
			const a = point(current.x, current.y), b = point(event.clientX, event.clientY);
			const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
			if (rect.w * pageRect.width < 12 || rect.h * pageRect.height < 12) return;
			let cropBase64 = '';
			try {
				const canvas = pageEl.querySelector('canvas');
				if (canvas) {
					const sx = rect.x * canvas.width, sy = rect.y * canvas.height, sw = rect.w * canvas.width, sh = rect.h * canvas.height;
					if (sw >= 1 && sh >= 1) {
						const out = document.createElement('canvas');
						out.width = Math.max(1, Math.round(sw));
						out.height = Math.max(1, Math.round(sh));
						out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
						cropBase64 = out.toDataURL('image/png').split(',')[1] || '';
					}
				}
			} catch { cropBase64 = ''; }
			const flowRect = flow.getBoundingClientRect();
			setDraft({ page: Number(pageEl.dataset.pageNumber) || 1, rects: [rect], quote: '', pin: { x: rect.x + rect.w, y: rect.y + rect.h }, question: '', kind: 'region', cropBase64, screen: { left: pageRect.left - flowRect.left + rect.x * pageRect.width, top: pageRect.top - flowRect.top + rect.y * pageRect.height } });
			setOpenId(null);
		};
		flow.addEventListener('pointerdown', down);
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		return () => { flow.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); rubber.remove(); };
	}, [flowRef, enabled, active, regionMode, hand]);

	const pageTextFor = useCallback(async (page) => {
		try {
			const pdfPage = await doc?.getPage?.(page);
			const content = await pdfPage?.getTextContent?.();
			return (content?.items ?? []).map((item) => item.str ?? '').join(' ').slice(0, 15000);
		} catch { return ''; }
	}, [doc]);

	const submit = async () => {
		if (!draft || submitting) return;
		const question = String(questionRef.current?.value ?? '').trim();
		if (!question) { setError('请填写问题'); return; }
		setSubmitting(true);
		setError('');
		try {
			const pageText = await pageTextFor(draft.page);
			const item = await call('tasks_annotations_create', {
				...request,
				page: draft.page,
				kind: draft.kind ?? 'text',
				rects: draft.rects,
				quote: draft.quote,
				pin: draft.pin,
				question,
				pageText,
				cropBase64: draft.cropBase64
			});
			setItems((old) => [...old, item]);
			openItemRef.current = item;
			setOpenId(item.id);
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

	const askFollow = async (item) => {
		const question = followText.trim();
		if (!question) return;
		setFollowText('');
		try {
			const pageText = await pageTextFor(item.page);
			const updated = await call('tasks_annotations_ask', { ...request, annotationId: item.id, question, pageText });
			setItems((old) => old.map((row) => row.id === item.id ? { ...row, ...updated, status: 'pending' } : row));
		} catch (reason) { setError(reason.message || String(reason)); }
	};

	const adoptDraft = async (item) => {
		try {
			const updated = await call('tasks_annotations_adopt', { ...request, annotationId: item.id });
			setItems((old) => old.map((row) => row.id === item.id ? updated : row));
		} catch (reason) { setError(reason.message || String(reason)); }
	};

	const dismissDraft = async (item) => {
		try {
			const updated = await call('tasks_annotations_dismiss', { ...request, annotationId: item.id });
			setItems((old) => old.map((row) => row.id === item.id ? updated : row));
		} catch (reason) { setError(reason.message || String(reason)); }
	};

	useEffect(() => { if (!openId) openItemRef.current = null; }, [openId]);

	const openAtPin = useCallback((item) => {
		const pageEl = pageElement(item.page);
		if (!pageEl || !item.pin) return false;
		openItemRef.current = item;
		setOpenId(item.id);
		return true;
	}, [pageElement]);

	const locate = (item) => {
		setTocOpen(false);
		setOpenId(null);
		openItemRef.current = null;
		const flow = flowRef.current;
		const pageEl = pageElement(item.page);
		if (!flow || !pageEl) return;
		// 把框选位置（而不是页首）滚到可视区域中间，再打开卡片。
		const anchorY = pageEl.offsetTop + (item.pin?.y ?? 0.5) * pageEl.offsetHeight;
		const target = anchorY - flow.clientHeight / 2;
		flow.scrollTop = Math.max(0, Math.min(flow.scrollHeight - flow.clientHeight, target));
		bump();
		setTimeout(() => { openAtPin(item); }, 160);
	};

	const geometry = useMemo(() => {
		tick; zoom;
		const flow = flowRef.current;
		if (!flow) return null;
		const flowRect = flow.getBoundingClientRect();
		const pages = new Map();
		const wanted = new Set(items.map((item) => item.page));
		if (draft) wanted.add(draft.page);
		if (openId) { const current = items.find((item) => item.id === openId); if (current) wanted.add(current.page); }
		for (const page of wanted) {
			const pageEl = pageElement(page);
			if (!pageEl) continue;
			const rect = pageEl.getBoundingClientRect();
			pages.set(page, { left: rect.left - flowRect.left + flow.scrollLeft, top: rect.top - flowRect.top + flow.scrollTop, width: rect.width, height: rect.height });
		}
		return { flowRect, pages, scrollLeft: flow.scrollLeft, scrollTop: flow.scrollTop };
	}, [tick, zoom, flowRef, items, draft?.page, openId, doc, flowReady, pageElement]);

	if (!enabled || !active || !doc || !flowReady || !geometry) return null;
	const { flowRect, pages } = geometry;
	const pagePoint = (page, point) => {
		const rect = pages.get(page);
		if (!rect) return null;
		return { left: rect.left + point.x * rect.width, top: rect.top + point.y * rect.height };
	};
	const overlayStyle = { position: 'fixed', left: flowRect.left, top: flowRect.top, width: flowRect.width, height: flowRect.height, pointerEvents: 'none', zIndex: 8, overflow: 'hidden' };
	const flow = flowRef.current;
	const scrollX = flow?.scrollLeft ?? 0;
	const scrollY = flow?.scrollTop ?? 0;
	const anchor = draft ? pagePoint(draft.page, draft.pin) : null;
	const open = openId ? items.find((item) => item.id === openId) : null;
	const openPoint = open?.pin ? pagePoint(open.page, open.pin) : null;
	const screenAnchor = anchor ? { left: anchor.left - scrollX, top: anchor.top - scrollY } : null;
	const composePos = draft?.screen ?? screenAnchor;
	const sortedItems = items.slice().sort((a, b) => a.page - b.page);

	return h('div', { ref: overlayRef, className: 'ib-anno-overlay', style: overlayStyle, 'data-annotations': true },
		h('div', { ref: contentRef, className: 'ib-anno-content', style: { position: 'absolute', inset: 0, pointerEvents: 'none', transform: `translate(${-scrollX}px, ${-scrollY}px)` } },
		items.map((item) => {
			const pin = item.pin ? pagePoint(item.page, item.pin) : null;
			if (!pin) return null;
			return h(React.Fragment, { key: item.id },
				(item.rects ?? []).map((rect, index) => {
					const pageRect = pages.get(item.page);
					const left = pageRect ? pageRect.left + rect.x * pageRect.width : 0;
					const top = pageRect ? pageRect.top + rect.y * pageRect.height : 0;
					return h('span', { key: index, className: 'ib-anno-highlight', 'data-status': item.status, style: { left, top, width: rect.w * pages.get(item.page).width, height: rect.h * pages.get(item.page).height } });
				}),
				h('button', {
					type: 'button',
					className: 'ib-anno-pin',
					'data-status': item.status,
					'data-open': openId === item.id ? 'true' : undefined,
					style: { left: pin.left, top: pin.top },
					title: item.question || item.quote,
					onPointerDown: (event) => event.stopPropagation(),
					onClick: (event) => { event.stopPropagation(); openAtPin(item); setEditing(null); },
					onDoubleClick: (event) => { event.stopPropagation(); openAtPin(item); setEditing({ id: item.id, value: item.shortAnswer || item.modelAnswer || '' }); }
				}, item.status === 'pending' || item.status === 'running' ? h('span', { className: 'ib-reader-spinner' }) : null)
			);
		}),
		draft ? (draft.rects ?? []).map((rect, index) => {
			const pageEl = pageElement(draft.page);
			if (!pageEl) return null;
			const pageRect = pageEl.getBoundingClientRect();
			const flowRectNow = flowRef.current?.getBoundingClientRect();
			if (!flowRectNow) return null;
			return h('span', { key: `draft-${index}`, className: 'ib-anno-highlight ib-anno-draft', style: { left: pageRect.left - flowRectNow.left + (flowRef.current?.scrollLeft ?? 0) + rect.x * pageRect.width, top: pageRect.top - flowRectNow.top + (flowRef.current?.scrollTop ?? 0) + rect.y * pageRect.height, width: rect.w * pageRect.width, height: rect.h * pageRect.height } });
		}) : null),
		composePos ? h('div', { className: 'ib-anno-compose', onPointerDown: (event) => event.stopPropagation(), style: { left: Math.max(8, Math.min(flowRect.width - 300, composePos.left + 8)), top: Math.max(8, Math.min(flowRect.height - 170, composePos.top + 12)) } },
			h('div', { className: 'ib-anno-compose-quote' }, short(draft.quote || (draft.kind === 'region' ? `已框选第 ${draft.page} 页区域（截图将发给 AI）` : ''), 120)),
			h('textarea', { key: `${draft.page}-${draft.pin?.x}-${draft.pin?.y}`, ref: questionRef, autoFocus: true, rows: 3, placeholder: '就框选内容提问…', defaultValue: '', onKeyDown: (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); } }),
			h('div', { className: 'ib-anno-compose-actions' },
				h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => { setDraft(null); window.getSelection()?.removeAllRanges(); } }, '取消'),
				h('button', { type: 'button', className: 'ib-anno-btn', 'data-primary': true, disabled: submitting, onClick: () => void submit() }, submitting ? '提交中…' : '提交'))
		) : null,
		open && openPoint && false ? h('div', { ref: cardLayerRef, className: 'ib-anno-card-layer', style: { position: 'absolute', inset: 0, pointerEvents: 'none', transform: `translate(${-scrollX}px, ${-scrollY}px)` } },
		h('div', { className: 'ib-anno-card', onPointerDown: (event) => event.stopPropagation(), style: { left: Math.max(8, Math.min((flow?.scrollWidth ?? flowRect.width) - 340, openPoint.left + 12)), top: openPoint.top + 12 }, onClick: (event) => event.stopPropagation() },
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
					open.draftAnswer ? h('div', { className: 'ib-anno-draft' },
						h('div', { className: 'ib-anno-draft-label' }, '追问草稿'),
						h('div', null, open.draftAnswer),
						h('div', { className: 'ib-anno-card-actions' },
							h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => void dismissDraft(open) }, '放弃'),
							h('button', { type: 'button', className: 'ib-anno-btn', 'data-primary': true, onClick: () => void adoptDraft(open) }, '采用'))) : null,
					h('div', { className: 'ib-anno-card-actions' },
						h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => setEditing({ id: open.id, value: open.shortAnswer || open.modelAnswer || '' }) }, '编辑'),
						open.status === 'failed' ? h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => void retry(open) }, '重试') : null,
						h('button', { type: 'button', className: 'ib-anno-btn', 'data-danger': true, onClick: () => void remove(open) }, '删除'))),
				h('div', { className: 'ib-anno-follow' },
					h('textarea', { rows: 2, placeholder: '继续追问…', value: followText, onChange: (event) => setFollowText(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void askFollow(open); } }),
					h('button', { type: 'button', className: 'ib-anno-btn', disabled: !followText.trim(), onClick: () => void askFollow(open) }, '追问')))) : null,
		marginHost ? ReactDOM.createPortal(
			h('div', { className: 'ib-anno-panel' },
				h('div', { className: 'ib-anno-panel-head' }, h('strong', null, '批注'), h('span', null, `${items.length} 条`)),
				sortedItems.length ? h('div', { className: 'ib-anno-panel-tabs' }, sortedItems.map((item, index) => h('button', { key: item.id, type: 'button', className: 'ib-anno-panel-tab', 'data-active': openId === item.id ? 'true' : undefined, 'data-status': item.status, onClick: () => openAtPin(item) }, `批注 ${String(index + 1).padStart(2, '0')}`))) : null,
				open ? h('article', { ref: panelCardRef, className: 'ib-anno-panel-card', 'data-status': open.status },
					h('div', { className: 'ib-anno-panel-card-head' },
						h('b', null, `批注 ${String(sortedItems.findIndex((row) => row.id === open.id) + 1).padStart(2, '0')}`),
						h('span', { className: 'ib-anno-status', 'data-status': open.status }, annotationStatusText(open)),
						h('button', { type: 'button', className: 'ib-anno-panel-icon', title: '编辑短答', onClick: () => setEditing({ id: open.id, value: open.shortAnswer || open.modelAnswer || '' }) }, '✎'),
						h('button', { type: 'button', className: 'ib-anno-panel-icon', title: '删除批注', onClick: () => void remove(open) }, '⋯')),
					h('div', { className: 'ib-anno-panel-meta' }, `第 ${open.page} 页 · ${open.kind === 'region' ? '框选区域' : '原文'}`),
					h('div', { className: 'ib-anno-panel-question' }, open.question),
					editing?.id === open.id
						? h('div', null,
							h('textarea', { autoFocus: true, rows: 5, value: editing.value, onChange: (event) => setEditing({ id: open.id, value: event.target.value }) }),
							h('div', { className: 'ib-anno-card-actions' },
								h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => setEditing(null) }, '取消'),
								h('button', { type: 'button', className: 'ib-anno-btn', 'data-primary': true, onClick: () => void saveEdit(open) }, '保存')))
						: h('div', null,
							h('div', { className: 'ib-anno-panel-answer' }, open.status === 'pending' || open.status === 'running' ? '正在根据原文生成短答…' : (open.shortAnswer || open.modelAnswer || '（暂无短答）')),
							open.error ? h('div', { className: 'ib-anno-card-error' }, open.error) : null,
							open.draftAnswer ? h('div', { className: 'ib-anno-panel-draft' },
								h('div', { className: 'ib-anno-draft-label' }, '追问草稿'),
								h('div', null, open.draftAnswer),
								h('div', { className: 'ib-anno-card-actions' },
									h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => void dismissDraft(open) }, '放弃'),
									h('button', { type: 'button', className: 'ib-anno-btn', 'data-primary': true, onClick: () => void adoptDraft(open) }, '采用'))) : null,
							(open.basis ?? []).length ? h('details', { className: 'ib-anno-panel-basis' },
								h('summary', null, '查看原文依据'),
								open.basis.map((row, index) => h('div', { key: index }, `第 ${row.page} 页：${short(row.quote, 160)}`))) : null,
							open.status === 'failed' ? h('div', { className: 'ib-anno-card-actions' }, h('button', { type: 'button', className: 'ib-anno-btn', onClick: () => void retry(open) }, '重试')) : null),
					h('div', { className: 'ib-anno-panel-follow' },
						h('textarea', { rows: 2, placeholder: '继续追问…', value: followText, onChange: (event) => setFollowText(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void askFollow(open); } }),
						h('button', { type: 'button', className: 'ib-anno-panel-send', disabled: !followText.trim(), title: '发送追问', onClick: () => void askFollow(open) }, '↑')))
				: h('div', { className: 'ib-anno-panel-empty' }, '在正文或图表上点「框选提问」，批注会出现在这里。'),
				error ? h('div', { className: 'ib-anno-error' }, error) : null
			), marginHost) : null,
		error ? h('div', { className: 'ib-anno-error' }, error) : null
	);
}

export const annotationStyles = `
.ib-anno-overlay{pointer-events:none;overflow:hidden}
.ib-anno-toc{display:none}
.ib-anno-content{position:absolute;inset:0;pointer-events:none}
.ib-anno-rubber{position:absolute;border:1.5px dashed #137c72;background:rgba(19,124,114,.12);pointer-events:none;z-index:7;box-sizing:border-box}
.ib-reader .ib-pdf-flow[data-region=true]{cursor:crosshair}
.ib-reader .ib-pdf-flow[data-region=true] .textLayer{pointer-events:none;user-select:none}
.ib-anno-highlight{position:absolute;background:rgba(19,124,114,.16);outline:1px solid rgba(19,124,114,.35);border-radius:2px;pointer-events:none}
.ib-anno-highlight.ib-anno-draft{background:rgba(19,124,114,.22);outline:1.5px dashed #137c72}
.ib-anno-panel{position:relative;height:100%;box-sizing:border-box;padding:14px 14px 20px;display:flex;flex-direction:column;gap:10px;font-size:12px;color:#303744;overflow:hidden}
.ib-anno-panel-head{display:flex;align-items:center;justify-content:space-between;color:#5c6a76}.ib-anno-panel-head strong{font-size:14px;color:#1f3a3a}
.ib-anno-panel-tabs{display:flex;gap:6px;flex-wrap:wrap}
.ib-anno-panel-tab{border:1px solid #d7dfe8;background:#fff;border-radius:999px;padding:3px 9px;font-size:11px;color:#5c6a76;cursor:pointer}
.ib-anno-panel-tab[data-active=true]{background:#e8f3f0;border-color:#137c72;color:#0f5f57}
.ib-anno-panel-card{position:absolute;left:14px;right:14px;top:100px;max-height:calc(100% - 110px);overflow:auto;background:#fff;border:1px solid #e2e8ee;border-radius:10px;padding:14px;box-shadow:0 4px 16px #0000000a;box-sizing:border-box}
.ib-anno-panel-card-head{display:flex;align-items:center;gap:8px;color:#1f3a3a}.ib-anno-panel-card-head b{font-size:13px}
.ib-anno-status{margin-left:auto;font-size:11px;color:#2f7a4f;background:#e9f5ee;border-radius:999px;padding:2px 8px}
.ib-anno-status[data-status=pending],.ib-anno-status[data-status=running]{color:#8a641f;background:#fbf1dd}.ib-anno-status[data-status=failed]{color:#a33;background:#fdeeee}
.ib-anno-panel-icon{border:0;background:transparent;color:#8a96a3;cursor:pointer;font-size:14px;padding:2px 4px}
.ib-anno-panel-meta{color:#8a96a3;font-size:11px;margin:6px 0 10px}
.ib-anno-panel-question{font-size:15px;font-weight:600;line-height:1.5;color:#1f3a3a;margin-bottom:10px}
.ib-anno-panel-answer{background:#f6f8fa;border-left:3px solid #9fc7bd;border-radius:6px;padding:10px 12px;line-height:1.7;white-space:pre-wrap;color:#26313d;margin-bottom:10px}
.ib-anno-panel-draft{border:1px dashed #d7b26a;background:#fffaf0;border-radius:6px;padding:8px 10px;margin-bottom:8px}
.ib-anno-panel-basis{border-top:1px solid #edf0f3;padding-top:8px;margin-top:8px;color:#5c6a76;font-size:11px}
.ib-anno-panel-basis summary{cursor:pointer;color:#607080}.ib-anno-panel-basis>div{margin-top:6px;line-height:1.5}
.ib-anno-panel-follow{display:flex;gap:6px;align-items:flex-end;margin-top:12px;border-top:1px solid #edf0f3;padding-top:10px}
.ib-anno-panel-follow textarea{flex:1;box-sizing:border-box;border:1px solid #dce1e8;border-radius:6px;padding:7px;font:inherit;resize:vertical;color:#26313d}
.ib-anno-panel-send{width:30px;height:30px;flex:none;border-radius:7px;background:#137c72;color:#fff;border:0;cursor:pointer;font-size:15px}
.ib-anno-panel-send:disabled{opacity:.4;cursor:default}
.ib-anno-panel-empty{color:#8a96a3;line-height:1.7;padding:14px;border:1px dashed #d7dfe8;border-radius:10px;background:#fff}
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
.ib-anno-toc{position:absolute;right:10px;top:8px;pointer-events:auto;z-index:10;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.ib-anno-toc-toggle{border:1px solid #d6dee6;background:#fffffff2;color:#40505f;border-radius:999px;padding:4px 12px;font:11px/1.4 system-ui,Segoe UI,Microsoft YaHei,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.ib-anno-toc-toggle:hover{background:#fff;color:#137c72}
.ib-anno-toc-panel{width:256px;max-height:58vh;overflow:auto;background:#fff;border:1px solid #d7dfe8;border-radius:8px;box-shadow:0 6px 24px rgba(21,45,66,.18);padding:6px;font:12px/1.4 system-ui,Segoe UI,Microsoft YaHei,sans-serif;color:#303744}
.ib-anno-toc-head{font-weight:600;color:#44586a;padding:4px 6px 6px;font-size:11px}
.ib-anno-toc-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;border:0;background:transparent;border-radius:6px;padding:6px;cursor:pointer;text-align:left;font:inherit;color:inherit}
.ib-anno-toc-item:hover{background:#f2f6f9}.ib-anno-toc-item b{font-size:11px;color:#137c72}.ib-anno-toc-item span{font-size:11px;color:#5c6a76;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ib-anno-toc-item[data-status=failed] b{color:#af3333}
.ib-anno-draft{margin-top:6px;border:1px dashed #b9d7d1;border-radius:6px;padding:6px;background:#f6fbf9}
.ib-anno-draft-label{font-weight:600;color:#137c72;font-size:11px;margin-bottom:3px}
.ib-anno-follow{display:flex;gap:6px;margin-top:8px;border-top:1px solid #eef2f5;padding-top:8px}
.ib-anno-follow textarea{flex:1;min-width:0;font-size:11px}
`;
