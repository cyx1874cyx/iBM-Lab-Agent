import {normalizeDoi} from 'dsh-lab-agent/literature/search-engine';
import {paperSourceBundleSchema,readingReportSchema} from 'dsh-lab-agent/task-models';
import {normalizedPaperTitle} from 'dsh-lab-agent/literature/material-kind';

export function sameReadingPaper(a,b){
 const left=normalizeDoi(a.doi),right=normalizeDoi(b.doi);
 if(left&&right)return left===right;
 if(a.pdfSha256&&a.pdfSha256===b.pdfSha256)return true;
 const title=normalizedPaperTitle(a.title);
 return title.length>=25&&title===normalizedPaperTitle(b.title)&&Boolean(a.year&&a.year===b.year)&&Boolean(a.authors?.some(author=>b.authors?.some(other=>normalizedPaperTitle(author)===normalizedPaperTitle(other))));
}

export function canonicalReadingRecord(table,id){
 const visited=new Set();let row=table.get(id),projectId=row?.projectId;
 while(row?.mergedInto){
  if(visited.has(row.id))throw Error('文献合并引用循环');visited.add(row.id);
  const next=table.get(row.mergedInto);if(!next||next.projectId!==projectId)return row;row=next;
 }
 return row;
}
const reportScore=row=>Number(!!row.docxPath)*8+Number(!!row.paperCardPath)*4+Number(!!row.sessionId)+Number(!!row.folderId);
const bundleScore=(row,reports)=>Number((row.translations??[]).some(t=>['queued','running'].includes(t.status)))*1000+Number(!!row.pdfPath)*100+Number((row.translations??[]).some(t=>t.status==='completed'))*50+Math.max(0,...reports.filter(r=>r.bundleId===row.id).map(reportScore))*2+Number(!!row.conversationSessionId);
const oldest=(a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
// A citation or translated title is display text, never a paper identity.
export const readingDedupMethods={
 async reconcileDuplicateReadingEntries(projectId){
  return this.withFolderLock(projectId,async()=>{
   const bundles=this.table('bundles'),reports=this.table('reports');
   const rows=[...bundles.keys()].map(id=>bundles.get(id)).filter(row=>row.projectId===projectId&&!row.mergedInto&&row.pdfIntake?.kind!=='si'&&row.pdfIntake?.kind!=='non-paper'&&!['queued','running','rejected'].includes(row.pdfIntake?.status));
   const groups=[];
   for(const row of rows){
    const group=groups.find(group=>group.some(other=>sameReadingPaper(row,other))&&!group.some(other=>normalizeDoi(row.doi)&&normalizeDoi(other.doi)&&normalizeDoi(row.doi)!==normalizeDoi(other.doi)));
    if(group)group.push(row);else groups.push([row]);
   }
   const merged=[];
   for(const group of groups.filter(g=>g.length>1)){
    const allReports=[...reports.keys()].map(id=>reports.get(id)).filter(r=>r.projectId===projectId&&!r.mergedInto&&group.some(b=>b.id===r.bundleId));
    // A running translation owns its source bytes and must not be redirected.
    if(group.filter(b=>(b.translations??[]).some(t=>['queued','running'].includes(t.status))).length>1)continue;
    group.sort((a,b)=>bundleScore(b,allReports)-bundleScore(a,allReports)||oldest(a,b));
    const primary=group[0],others=group.slice(1),time=new Date().toISOString();
    const versions=[...(primary.sourceVersions??[])];
    let next={...primary};
    for(const other of others){
     for(const key of ['doi','journal','year','volume','pages','abstract','paperMdPath','sourceMapPath','siPath','siSha256','siMdPath','conversationSessionId'])if(!next[key]&&other[key])next[key]=other[key];
     if(!next.authors?.length&&other.authors?.length)next.authors=other.authors;
     for(const kind of ['pdf','si'])if(other[kind+'Path']&&other[kind+'Sha256'])versions.push({bundleId:other.id,kind,path:other[kind+'Path'],sha256:other[kind+'Sha256']});
     versions.push(...(other.sourceVersions??[]));
     next.translations=[...(next.translations??[]),...(other.translations??[]).filter(t=>!(next.translations??[]).some(x=>x.id===t.id))];
    }
    next.sourceVersions=versions.filter((v,i)=>versions.findIndex(x=>x.kind===v.kind&&x.sha256===v.sha256)===i);
    const winner=allReports.sort((a,b)=>reportScore(b)-reportScore(a)||oldest(a,b))[0];
    const changes=[{table:bundles,id:primary.id,before:primary,after:paperSourceBundleSchema.parse({...next,updatedAt:time})}];
    if(winner){
     const folder=winner.folderId||allReports.find(r=>r.folderId)?.folderId;
     changes.push({table:reports,id:winner.id,before:winner,after:readingReportSchema.parse({...winner,bundleId:primary.id,folderId:folder,updatedAt:time})});
     for(const r of allReports.filter(r=>r.id!==winner.id))changes.push({table:reports,id:r.id,before:r,after:readingReportSchema.parse({...r,mergedInto:winner.id,updatedAt:time})});
    }
    for(const other of others)changes.push({table:bundles,id:other.id,before:other,after:paperSourceBundleSchema.parse({...other,mergedInto:primary.id,updatedAt:time})});
    const written=[];
    try{for(const c of changes){await c.table.put(c.id,c.after);written.push(c);}}
    catch(error){for(const c of written.reverse())await c.table.put(c.id,c.before);throw error;}
    merged.push({bundleId:primary.id,reportId:winner?.id,previousBundleIds:others.map(b=>b.id)});
   }
   return {merged};
  });
 }
};
