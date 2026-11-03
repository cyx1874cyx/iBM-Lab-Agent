/**
 * 试剂管理子插件（@ibm-lab/reagents）宿主服务。
 *
 * 与母插件的关系：只通过公开能力工作——
 *   - 文件选择/打开走宿主桌面能力 `ibmScientificDesktop.requireBroker()`，
 *     该能力可能不存在（Web/Linux 形态），此时方法返回 feature-unavailable，
 *     不阻断插件自身启动；
 *   - 数据根目录由装配配置注入（cordis.patch.yml 里的 dshHomePath），
 *     未注入时退化为 $DSH_HOME/lab-agent/reagents，便于独立测试。
 *
 * 不导入母插件任何内部模块（lib/*、src/*），只依赖本包 src/。
 */
import { Service } from "@deepseek-ai/cordis";
import { homedir } from "node:os";
import { join } from "node:path";
import { ReagentCatalog } from "dsh-lab-agent/reagents/catalog";

/** 与母插件 json-boundary 的 cleanJson 语义一致：只允许可结构化克隆的数据过线。 */
const cleanJson = (value) => JSON.parse(JSON.stringify(value ?? null));

function defaultRoot(env = process.env) {
	const home = env.DSH_HOME || join(homedir(), ".dsh");
	return join(home, "lab-agent", "reagents");
}

export class ReagentsService extends Service {
	/**
	 * 不声明强依赖：核心启动不等待桌面桥。
	 * 需要桌面能力的方法在调用时查找，缺失即返回 feature-unavailable。
	 */
	static inject = [];

	constructor(ctx, config = {}) {
		super(ctx, "labReagents");
		this.config = config ?? {};
		this.root = this.config.root ?? this.config.reagentsRoot ?? defaultRoot();
	}

	catalog() {
		return (this.instance ??= new ReagentCatalog(this.root));
	}

	broker() {
		const desktop = this.ctx.get("ibmScientificDesktop");
		if (desktop === undefined) {
			const error = new Error("当前运行形态没有桌面文件能力，无法选择或打开本机清单");
			error.code = "feature-unavailable";
			throw error;
		}
		return desktop.requireBroker();
	}

	async search(request) {
		return cleanJson(await this.catalog().search(request));
	}

	async chooseSource(request) {
		const id = request?.id;
		if (!["chemical", "biological", "cells"].includes(id)) throw new Error("未知清单类型");
		const selected = await this.broker().call("chooseReagentSource", {}, 300000);
		if (selected.cancelled) return { cancelled: true };
		return cleanJson(await this.catalog().setSource(id, selected.path));
	}

	async openSource(request) {
		const source = await this.catalog().source(request?.id);
		return this.broker().call("openReagentSource", { path: source.path });
	}
}

export default ReagentsService;
