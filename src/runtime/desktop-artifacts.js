/** Resolve registered artifacts locally. Never fetch a client-supplied URL or accept a disk path. */
export async function resolveDesktopArtifact(core, input, { requireApproved = false, translationFile } = {}) {
 if (typeof input !== "string" || !input.startsWith("/api/lab-artifacts?")) throw new Error("Only registered artifact references are supported");
 const url = new URL(input, "http://artifact.invalid");
 if (url.pathname !== "/api/lab-artifacts" || url.hash) throw new Error("Invalid artifact reference");
 const kind = url.searchParams.get("kind");
 const id = key => { const value = url.searchParams.get(key); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value ?? "")) throw new Error("Invalid artifact identity"); return value; };
 if(kind==='translation'){const material=url.searchParams.get('material');if(!['pdf','si'].includes(material)||!translationFile)throw Error('Invalid translation artifact');return translationFile({projectId:id('projectId'),bundleId:id('bundleId'),translationId:id('translationId'),kind:material});}
 if (["pdf", "si"].includes(kind)) return await core.bundleFile(id("bundleId"), kind);
 if (kind === "report") return await core.readingReportFile(id("reportId"), url.searchParams.get("format") === "docx" || url.searchParams.get("preview") === "1" ? "docx" : "md", { requireApproved });
 if (kind === "ppt") return await core.presentationFile(id("reportId"), { requireApproved });
 if (["review", "review-ppt"].includes(kind)) return await core.reviewFile(id("runId"), kind === "review" ? "report" : "ppt");
 throw new Error("Unsupported desktop artifact kind");
}
