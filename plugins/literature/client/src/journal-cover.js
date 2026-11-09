import React, { useEffect, useState } from "react";
import { h } from "dsh-lab-agent/client-sdk";

const coverCache = new Map();

export function JournalCover({ journal, call, fallback, large = false, projectId = "" }) {
	const cached = journal ? coverCache.get(journal) || "" : "";
	const [url, setUrl] = useState(cached);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setUrl(coverCache.get(journal) || "");
		setFailed(false);
		if (!journal || !call) return undefined;
		const known = coverCache.get(journal);
		if (known) { setUrl(known); return undefined; }
		let active = true;
		void call("journal_cover_get", { request: { journal, projectId } }).then((result) => {
			if (!active || !result?.cover) return;
			coverCache.set(journal, result.cover);
			setUrl(result.cover);
		}).catch(() => {});
		return () => { active = false; };
	}, [journal, call]);
	const clean = String(journal || fallback || "").trim();
	const short = clean.length <= 14;
	const label = short ? clean.toUpperCase() : clean;	const retry = async () => { if (!journal || !call) return; try { await call("journal_covers_sync", { request: { journals: [journal], projectId } }); await new Promise((resolve) => setTimeout(resolve, 2500)); const result = await call("journal_cover_get", { request: { journal, projectId } }); if (result?.cover) { coverCache.set(journal, result.cover); setFailed(false); setUrl(result.cover); } } catch { /* ignore */ } };
	return h("span", { className: "ib-paper-cover" + (large ? " ib-paper-cover-lg" : ""), title: url ? "" : "点击获取期刊封面", onClick: url ? undefined : retry },
		url && !failed ? h("img", { src: url, alt: "", loading: "lazy", onError: () => setFailed(true) }) : h(React.Fragment, null, h("b", { title: clean, style: short ? { fontSize: "17px", lineHeight: 1.15 } : { fontSize: "9px", lineHeight: 1.2, fontWeight: 600 } }, label), short ? h("small", null, "JOURNAL") : null));
}
