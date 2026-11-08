import React, { useEffect, useState } from "react";
import { h } from "dsh-lab-agent/client-sdk";

export function JournalCover({ journal, call, fallback, large = false }) {
	const key = journal ? `ib-lit-cover:${journal}` : "";
	const read = () => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
	const [url, setUrl] = useState(read);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setFailed(false);
		if (!journal || !call) return undefined;
		const cached = read();
		if (cached) { setUrl(cached); return undefined; }
		let active = true;
		void call("tasks_journal_metrics", { request: { journal } }).then((value) => {
			const cover = value?.coverUrl;
			if (!active || !cover) return;
			setUrl(cover);
			try { localStorage.setItem(key, cover); } catch { /* ignore */ }
		}).catch(() => {});
		return () => { active = false; };
	}, [journal, call, key]);
	const label = String(fallback || "PREPRINT").slice(0, 6).toUpperCase();
	return h("span", { className: "ib-paper-cover" + (large ? " ib-paper-cover-lg" : "") },
		url && !failed ? h("img", { src: url, alt: "", loading: "lazy", onError: () => setFailed(true) }) : h(React.Fragment, null, h("b", { style: label.length > 5 ? { fontSize: "17px" } : undefined }, label), h("small", null, "JOURNAL")));
}
