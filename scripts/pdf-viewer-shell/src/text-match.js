export function normalizeWithMap(raw) {
  const chars = [], map = [];
  for (let i = 0; i < raw.length; ) {
    const cp = String.fromCodePoint(raw.codePointAt(i));
    const at = i;
    i += cp.length;
    if (cp === "­") continue;
    if (cp === "-" && /\s/.test(raw[i] || "")) {
      while (i < raw.length && /\s/.test(raw[i])) i++;
      continue;
    }
    for (const c of cp.normalize("NFKC").toLowerCase().replace(/[−‐‑–—]/g, "-").replace(/[，。、；：！？「」『』（）《》【】“”‘’.,;:!?"'()\[\]{}<>]/g, " ")) {
      if (/\s/.test(c)) {
        if (!chars.length || chars[chars.length - 1] === " ") continue;
        chars.push(" ");
        map.push(at);
      } else {
        chars.push(c);
        map.push(at);
      }
    }
  }
  if (chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { norm: chars.join(""), normToRaw: map };
}
export const normalizeText = (text) => normalizeWithMap(String(text || "")).norm;
export function exactMatch(text, quote) {
  if (!quote) return null;
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + 1) >= 0) return null;
  return { start, end: start + quote.length };
}
export function fuzzyMatch(text, quote) {
  const tokens = quote.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 4) return null;
  const anchor = tokens.reduce((a, b) => a.length > b.length ? a : b);
  let candidates = [];
  for (let start = text.indexOf(anchor); start >= 0; start = text.indexOf(anchor, start + anchor.length)) {
    const left = Math.max(0, start - quote.length), right = Math.min(text.length, start + quote.length * 2);
    const segment = text.slice(left, right);
    let cursor = 0, hits = [];
    for (const token of tokens) {
      const at = segment.indexOf(token, cursor);
      if (at >= 0) {
        hits.push([left + at, left + at + token.length]);
        cursor = at + token.length;
      }
    }
    if (hits.length >= Math.ceil(tokens.length * 0.85) && hits.at(-1)[1] - hits[0][0] <= quote.length * 1.6) candidates.push({ start: hits[0][0], end: hits.at(-1)[1], fuzzy: true });
  }
  const unique = [...new Map(candidates.map((c) => [`${c.start}:${c.end}`, c])).values()];
  return unique.length === 1 ? unique[0] : null;
}
