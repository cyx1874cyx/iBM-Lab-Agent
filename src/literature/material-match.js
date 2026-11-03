import { normalizedPaperTitle } from './material-kind.js';

// Bibliography text cannot establish ownership of a supplement.
export function matchingBody(text = '') {
 return String(text).split(/^\s*(?:#{1,6}\s*)?(?:\*{1,2})?(?:references|bibliography)\s*(?:\*{1,2})?\s*$/im)[0].replace(/\|/g, ' ').replace(/[-_]{3,}/g, ' ').replace(/\s+/g, ' ').trim();
}

const numbers = text => new Set((String(text).match(/\d+(?:\.\d+)?/g) ?? []).filter(value => value.includes('.') || value.length >= 3));

export function matchingCandidates(material, candidates) {
 const sourceNumbers = numbers(material), words = new Set(material.toLowerCase().match(/[a-z]{5,}/g) ?? []);
 return candidates.filter(row => row.text).map(row => {
  const body = matchingBody(row.text), tokens = new Set(body.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const score = [...numbers(body)].filter(value => sourceNumbers.has(value)).reduce((sum,value) => sum + (value.includes('.') ? 10 : 3),0) + [...tokens].filter(value => words.has(value)).length;
  return { ...row, score };
 }).sort((a,b) => b.score - a.score).slice(0,8);
}

// Include the opening and the best overlapping passages, rather than cutting
// off the results near the end of a long article. All excerpts remain verbatim.
export function matchingExcerpt(paper, material, limit = 24000) {
 const body = matchingBody(paper);
 if (body.length <= limit) return body;
 const materialNumbers = numbers(material);
 const words = new Set((material.toLowerCase().match(/[a-z]{5,}/g) ?? []));
 const windows = [];
 for (let start = 3000; start < body.length; start += 1400) {
  const text = body.slice(start, start + 1800);
  const score = [...numbers(text)].filter(value => materialNumbers.has(value)).length * 5 + [...new Set(text.toLowerCase().match(/[a-z]{5,}/g) ?? [])].filter(value => words.has(value)).length;
  windows.push({ start, text, score });
 }
 const selected = windows.sort((a,b) => b.score - a.score).slice(0, Math.floor((limit - 3200) / 1800)).sort((a,b) => a.start - b.start);
 return body.slice(0,3000) + '\n[…]\n' + selected.map(row => row.text).join('\n[…]\n');
}

export function verifiedContentParent(match, material, candidates) {
 if (!match || !Array.isArray(match.evidence) || match.evidence.length < 2) return undefined;
 const source = normalizedPaperTitle(matchingBody(material));
 const quotes = match.evidence.map(row => ({ ...row, si: normalizedPaperTitle(row.siQuote), paper: normalizedPaperTitle(row.paperQuote) })).filter(row => row.si.length >= 25 && row.paper.length >= 25 && source.includes(row.si));
 const supported = candidates.filter(row => {
  const body = normalizedPaperTitle(matchingBody(row.text));
  const valid = [], shared = new Set();
  for (const quote of quotes) {
   if (!passagePresent(body, quote.paperQuote)) continue;
   // Repeating or overlapping one passage does not establish two anchors.
   if (valid.some(old => old.si.includes(quote.si) || quote.si.includes(old.si) || old.paper.includes(quote.paper) || quote.paper.includes(old.paper))) continue;
   const paperNumbers = numbers(quote.paperQuote), same = [...numbers(quote.siQuote)].filter(value => paperNumbers.has(value));
   if (!same.length) continue;
   valid.push(quote);for (const value of same) shared.add(value);
  }
  return valid.length >= 2 && shared.size >= 2;
 });
 return supported.length === 1 && supported[0].id === match.bundleId ? supported[0].id : undefined;
}

function passagePresent(body, quote) {
 const normalized = normalizedPaperTitle(quote);
 if (body.includes(normalized)) return true;
 // PDF text extraction can interleave the other column inside a sentence.
 // Require all words and numbers in order, with tightly bounded gaps, so a
 // reconstructed sentence is verified within one passage, not across pages.
 const tokens = (quote.match(/[\p{L}\p{N}]+(?:\.[0-9]+)*/gu) ?? []).map(normalizedPaperTitle);
 if (tokens.length < 4) return false;
 for (let start = body.indexOf(tokens[0]); start !== -1; start = body.indexOf(tokens[0], start + 1)) {
  let end = start + tokens[0].length, matches = true;
  for (const token of tokens.slice(1)) {
   const index = body.indexOf(token, end);
   if (index < 0 || index - end > 240 || index + token.length - start > 1000) { matches = false;break; }
   end = index + token.length;
  }
  if (matches) return true;
 }
 return false;
}

// Candidate bibliographic fields are context, not facts printed in the SI.
// Never let a copied candidate DOI bypass quotation-based verification.
export function groundedSiMetadata(metadata, markdown) {
 const body = normalizedPaperTitle(matchingBody(markdown));
 const title = metadata.title && body.includes(normalizedPaperTitle(metadata.title)) ? metadata.title : '';
 const doi = metadata.doi && body.includes(normalizedPaperTitle(metadata.doi)) ? metadata.doi : undefined;
 return { ...metadata, title, doi, ...(!title ? { titleZh: '' } : {}), ...(!title && !doi ? { journal: undefined, journalAbbrev: undefined, year: undefined, volume: undefined, pages: undefined, authors: [], correspondingAuthor: undefined } : {}) };
}
