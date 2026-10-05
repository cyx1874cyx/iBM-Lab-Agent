import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { LabRemoteService } from "./remote.js";

const domains = {
 runtime: ["labRuntime", "ibmRuntime", /^(versions_|python_|runtime_)/],
 documents: ["labDocuments", "ibmDocuments", /^(templates_|note_templates_|convert_)/],
 literature: ["labLiteratureWorkflows", "ibmLiteratureWorkflows", /^(goals_|tasks_|literature_|review_templates_|manual_capture_|browser_operation_)/],
 design: ["labDesign", "ibmDesign", /^(chem_|synth_|cas_|experiment_plan_templates_)/],
 analysis: ["labAnalysis", "ibmAnalysis", /^(nmr_|plot_records_|characterization_)/]
};

/** Domain namespaces share implementations and wire signatures with the historical lab facade. */
export function domainRemote(domain) {
 const [namespace, provider, matches] = domains[domain];
 const initializers = [];
 class DomainRemote extends TypertRemoteService {
  static inject = [provider];
  constructor(ctx) { super(ctx, namespace); for (const init of initializers) init.call(this); }
 }
 for (const helper of ["require", "buildPaperFileIndex"]) DomainRemote.prototype[helper] = LabRemoteService.prototype[helper];
 for (const method of Object.getOwnPropertyNames(LabRemoteService.prototype).filter(name => matches.test(name))) {
  DomainRemote.prototype[method] = LabRemoteService.prototype[method];
  Remote(method)(DomainRemote.prototype, { kind: "method", name: method, static: false, private: false, metadata: {},
   access: { has: object => method in object, get: object => object[method] }, addInitializer: init => initializers.push(init) });
 }
 return DomainRemote;
}
