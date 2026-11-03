/**
 * 可选功能（子插件）启停与排序（宿主后端，供 `lab.plugins_*` 使用）。
 *
 * 语义全部是"硬启停"：改写 profile 的 `dsh.profile.bundles`，下次启动生效。
 * 顺序保存在 `$DSH_HOME/lab-agent/plugin-order.json`，决定左侧「研究工具」的排列。
 */
import { Service } from "@deepseek-ai/cordis";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGINS = [
	{ id: "literature", name: "文献阅读", package: "@ibm-lab/literature", detail: "文献检索、精读、PPT 与阅读记录" },
	{ id: "knowledge", name: "RAG 知识库", package: "@ibm-lab/knowledge", detail: "项目内索引与带来源的问答" },
	{ id: "reagents", name: "试剂管理", package: "@ibm-lab/reagents", detail: "Excel 试剂清单检索与选择" },
	{ id: "nmr", name: "核磁解析", package: "@ibm-lab/nmr", detail: "Mnova 处理、标峰与模拟谱" },
	{ id: "plotting", name: "科研绘图", package: "@ibm-lab/plotting", detail: "Origin 图稿生成与编辑" },
	{ id: "polishing", name: "论文润色", package: "@ibm-lab/polishing", detail: "润色工作台（占位，未实现）" }
];
const PLUGIN_IDS = new Set(PLUGINS.map(plugin => plugin.id));

export class PluginSettingsBackend {
	constructor(config = {}) {
		this.config = config ?? {};
	}

	get home() {
		return this.config.home || process.env.DSH_HOME || join(homedir(), ".dsh");
	}

	get orderPath() {
		return join(this.home, "lab-agent", "plugin-order.json");
	}

	get profileDir() {
		if (this.config.profileDir) return this.config.profileDir;
		if (process.env.IBM_LAB_PROFILE_DIR) return process.env.IBM_LAB_PROFILE_DIR;
		const root = join(this.home, "profiles");
		if (!existsSync(root)) return undefined;
		const candidates = readdirSync(root, { withFileTypes: true })
			.filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, "package.json")))
			.map(entry => join(root, entry.name))
			.sort((left, right) => (this.#hasIbmDependency(right) ? 1 : 0) - (this.#hasIbmDependency(left) ? 1 : 0));
		return candidates[0];
	}

	#hasIbmDependency(dir) {
		try {
			const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			return Object.keys(manifest.dependencies ?? {}).some(name => name.startsWith("@ibm-lab/"));
		} catch {
			return false;
		}
	}

	async #readOrder() {
		if (!existsSync(this.orderPath)) return [];
		try {
			const parsed = JSON.parse(await readFile(this.orderPath, "utf8"));
			const list = Array.isArray(parsed?.order) ? parsed.order : [];
			return list.filter(id => PLUGIN_IDS.has(id));
		} catch {
			return [];
		}
	}

	async #writeOrder(order) {
		await mkdir(join(this.home, "lab-agent"), { recursive: true });
		await writeFile(this.orderPath, JSON.stringify({ order }, null, 2) + "\n", "utf8");
	}

	#profile() {
		const dir = this.profileDir;
		if (!dir) return undefined;
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) return undefined;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		return { dir, manifestPath, manifest, bundles: Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [] };
	}

	async list() {
		const profile = this.#profile();
		const stored = await this.#readOrder();
		const enabled = new Set(profile ? PLUGINS.filter(plugin => profile.bundles.includes(plugin.package)).map(plugin => plugin.id) : []);
		// 排序：已添加的按保存顺序在前，未添加的保持声明顺序在后。
		const ordered = [
			...stored.filter(id => enabled.has(id)),
			...PLUGINS.map(plugin => plugin.id).filter(id => enabled.has(id) && !stored.includes(id)),
			...PLUGINS.map(plugin => plugin.id).filter(id => !enabled.has(id))
		];
		const installed = new Set();
		if (profile) {
			for (const plugin of PLUGINS) {
				if (existsSync(join(profile.dir, "node_modules", ...plugin.package.split("/")))) installed.add(plugin.id);
			}
		}
		return {
			plugins: ordered.map(id => {
				const plugin = PLUGINS.find(item => item.id === id);
				return { ...plugin, enabled: enabled.has(id), installed: installed.has(id) };
			}),
			order: ordered.filter(id => enabled.has(id)),
			profileDir: profile?.dir ?? null,
			restartRequired: false
		};
	}

	#validate(request) {
		const id = request?.id;
		if (!PLUGIN_IDS.has(id)) throw new Error(`未知子插件：${id ?? "(空)"}`);
		return id;
	}

	async setEnabled(request = {}) {
		const id = this.#validate(request);
		const profile = this.#profile();
		if (!profile) throw new Error("找不到可管理的 profile，无法修改可选功能");
		const plugin = PLUGINS.find(item => item.id === id);
		const wanted = request.enabled !== false;
		const bundles = profile.bundles.filter(name => name !== plugin.package);
		if (wanted) bundles.push(plugin.package);
		profile.manifest.dsh ??= {};
		profile.manifest.dsh.profile ??= {};
		profile.manifest.dsh.profile.bundles = bundles;
		await writeFile(profile.manifestPath, JSON.stringify(profile.manifest, null, 2) + "\n", "utf8");

		const order = (await this.#readOrder()).filter(item => item !== id);
		if (wanted) order.push(id);
		await this.#writeOrder(order);
		return { ...(await this.list()), changed: id, restartRequired: true };
	}

	async setOrder(request = {}) {
		const requested = Array.isArray(request.order) ? request.order : [];
		if (requested.some(id => !PLUGIN_IDS.has(id))) throw new Error("排序里出现未知子插件");
		const profile = this.#profile();
		const enabled = new Set(profile ? PLUGINS.filter(plugin => profile.bundles.includes(plugin.package)).map(plugin => plugin.id) : []);
		const order = [...new Set(requested)].filter(id => enabled.has(id));
		for (const id of PLUGINS.map(plugin => plugin.id)) if (enabled.has(id) && !order.includes(id)) order.push(id);
		await this.#writeOrder(order);
		return { ...(await this.list()), changed: "order", restartRequired: true };
	}
}

export class LabPluginSettingsService extends Service {
	constructor(ctx, config = {}) {
		super(ctx, "labPlugins");
		this.backend = new PluginSettingsBackend(config);
	}

	list() { return this.backend.list(); }
	setEnabled(request) { return this.backend.setEnabled(request); }
	setOrder(request) { return this.backend.setOrder(request); }
}

export default LabPluginSettingsService;
