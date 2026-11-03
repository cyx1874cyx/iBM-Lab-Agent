// A page range and year alone do not identify a publication. Conference
// proceedings can have a source and pages without a journal volume.
export function publicationCitation(metadata = {}) {
 const journal = String(metadata.journalAbbrev || metadata.naming?.journalAbbrev || metadata.journal || '').trim();
 if (!journal || !/\p{L}/u.test(journal)) return undefined;
 const volume = String(metadata.volume || '').trim();
 const pages = String(metadata.pages || '').trim().replace(/\s*[-–—]\s*/g, '–');
 const year = metadata.year ? ` (${metadata.year})` : '';
 const details = [volume, pages].filter(Boolean).join(', ');
 const suffix = `${details ? ` ${details}` : ''}${year}.`;
 return { journal, suffix, text: journal + suffix };
}

export function usableShortCitation(value) {
 const text = String(value || '').trim();
 // Reject old partial citations such as "3723-3726 (2020)." or "e102373
 // (2024)."; the UI should use the real article title when source is unknown.
 const words = text.replace(/^(?:pp?\.?\s*)/i, '').replace(/(?:^|\s)[A-Za-z](?=\d)/g, '').replace(/[\d\s.,:;()[\]{}\-–—]/g, '');
 return /\p{L}/u.test(words) ? text : undefined;
}
