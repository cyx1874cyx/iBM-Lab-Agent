import React, { useEffect, useState } from "react";
import { h } from "dsh-lab-agent/client-sdk";

const coverCache = new Map();

export function JournalCover({ journal, call, fallback, large = false }) {
	const cached = journal ? coverCache.get(journal) || "" : "";
	const [url, setUrl] = useState(cached);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setFailed(false);
		if (!journal || !call) return undefined;
		const known = coverCache.get(journal);
		if (known) { setUrl(known); return undefined; }
		let active = true;
		void call("journal_cover_get", { request: { journal } }).then((result) => {
			if (!active || !result?.cover) return;
			coverCache.set(journal, result.cover);
			setUrl(result.cover);
		}).catch(() => {});
		return () => { active = false; };
	}, [journal, call]);
	const label = String(fallback || "PREPRINT").slice(0, 6).toUpperCase();
	return h("span", { className: "ib-paper-cover" + (large ? " ib-paper-cover-lg" : "") },
		url && !failed ? h("img", { src: url, alt: "", loading: "lazy", onError: () => setFailed(true) }) : h(React.Fragment, null, h("b", { style: label.length > 5 ? { fontSize: "17px" } : undefined }, label), h("small", null, "JOURNAL")));
}
