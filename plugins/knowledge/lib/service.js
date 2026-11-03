/**
 * RAG 知识库子插件宿主服务。
 *
 * 只依赖母插件公开的项目接口（ibmCore）；检索内核、索引、问答会话与来源定位
 * 全部由本插件实现（rag/ 与 project-knowledge.js）。母插件的 lab.knowledge_*
 * 在插件存在时整段委托到这里，保证只有一份 watcher / 一份索引缓存。
 */
import { Service } from "@deepseek-ai/cordis";
import { knowledgeFor } from "./project-knowledge.js";
import { readingTransferRequested, transferAuthorized } from "./reading.js";

export class LabKnowledgeService extends Service {
	static inject = ["ibmCore"];

	constructor(ctx, config = {}) {
		super(ctx, "labKnowledge");
		this.config = config ?? {};
	}

	/** 统一实例入口：与母插件遗留调用共用同一个 ProjectKnowledge。 */
	forCore(core = this.ctx.ibmCore) {
		return knowledgeFor(core, this.config.root ? { root: this.config.root } : undefined);
	}

	/** 知识库→精读的意图判断属于本域；母插件通过服务调用，不复制规则。 */
	readingTransferRequested(question) {
		return readingTransferRequested(question);
	}

	transferAuthorized(chat) {
		return transferAuthorized(chat);
	}
}

export default LabKnowledgeService;
