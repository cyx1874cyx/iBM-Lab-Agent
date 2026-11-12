import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const paperKey = paper => paper.doi ? `doi:${paper.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()}`
 : paper.pmid ? `pmid:${paper.pmid}` : paper.arxivId ? `arxiv:${paper.arxivId}`
 : paper.title ? `title:${paper.title.trim().toLowerCase()}:${paper.year || ''}` : `id:${paper.id}`;

/** Materialize the legacy registration table in the task model used by the visible UI.
 * Source signatures make repeated reads inert; user annotations and candidate IDs survive updates.
 */
export function projectRegisteredSearches(core, projectId, store) {
 if (typeof core.table !== 'function') return false;
 const table = core.table('searches');
 const groups = new Map();
 for (const id of table.keys()) {
  const row = table.get(id);
  if (row?.projectId !== projectId) continue;
  const key = row.sessionId ? `session:${row.sessionId}` : `run:${row.id}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
 }
 let changed = false;
 for (const [key, rows] of groups) {
  if ((store.dismissedRegistrationKeys || []).includes(key)) continue;
  rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  const signature = hash(rows);
  let task = store.tasks.find(item => item.legacySearchKey === key);
  if (task?.legacySearchSignature === signature) continue;
  const latest = rows.slice().sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).at(-1);
  if (!task) {
   task = { id: `registered-${hash([projectId, key]).slice(0, 24)}`, title: latest.title || latest.query || '检索记录',
    requirement: latest.query || '', sessionId: latest.sessionId, candidates: [], rounds: [], messages: [],
    createdAt: rows[0].createdAt, legacySearchKey: key };
   store.tasks.unshift(task);
   if (!store.activeTaskId) store.activeTaskId = task.id;
  }
  const byPaper = new Map((task.candidates || []).map(paper => [paperKey(paper), paper]));
  const roundId = `${task.id}:registered`;
  for (const row of rows) for (const paper of row.results || []) {
   const identity = paperKey(paper), existing = byPaper.get(identity);
   const incoming = { ...paper, source: paper.source || paper.sources?.[0] || 'registered',
    sourceUrl: paper.sourceUrl || paper.landingUrl || (paper.doi ? `https://doi.org/${paper.doi}` : undefined),
    summaryZh: paper.shortDescriptionZh, abstractStatus: paper.abstract ? 'available' : undefined };
   // Only source metadata is refreshed. UI decisions and enriched content remain intact.
   const next = { ...existing, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined && value !== '')),
    id: existing?.id || `${task.id}:paper:${hash(identity).slice(0, 16)}`,
    firstRound: existing?.firstRound || roundId };
   for (const field of ['selected', 'recommendation', 'feedback', 'addedToReading', 'bundleId', 'reportId', 'titleZh']) {
    if (existing && Object.hasOwn(existing, field)) next[field] = existing[field];
   }
   byPaper.set(identity, next);
  }
  task.candidates = [...byPaper.values()];
  const queries = [...new Set(rows.flatMap(row => row.queries?.length ? row.queries : [row.query]).filter(Boolean))];
  const round = { id: roundId, index: 1, label: '已登记检索', query: queries.join('\n'), queries,
   source: 'registered', fetched: task.candidates.length, totalAfter: task.candidates.length,
   newCount: task.candidates.length, status: latest.status, createdAt: rows[0].createdAt,
   candidateIds: task.candidates.map(paper => paper.id) };
  task.rounds = [round, ...(task.rounds || []).filter(item => item.id !== roundId)];
  task.legacySearchRunIds = rows.map(row => row.id);
  task.legacySearchSignature = signature;
  task.updatedAt = latest.updatedAt;
  changed = true;
 }
 return changed;
}
