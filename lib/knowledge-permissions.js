/** Audited read capabilities plus the previously authorized paper-transfer action. */
export const KNOWLEDGE_TOOLS=new Set(['lab_knowledge_list','lab_knowledge_search','lab_research_read','lab_project_memory_read','read','read_image','lab_knowledge_add_to_reading']);
export const knowledgeToolAllowed=name=>KNOWLEDGE_TOOLS.has(name);
