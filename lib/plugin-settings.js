/**
 * 子插件启停设置（宿主服务 `labPlugins`）。
 *
 * 两级语义，必须在界面上说清楚：
 *   - 软启停：立即隐藏入口（前端注册表按开关过滤），服务仍驻留，重启后保持；
 *   - 硬启停：改写 profile 的 `dsh.profile.bundles`，下次启动不再装配该插件（工具与服务一起消失）。
 *
 * DSH 的 bundle 在启动时装配，运行中没有卸载宿主插件的 API，所以硬启停必须重启。
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

	get flagsPath() {
		return join(this.home, "lab-agent", "plugin-flags.json");
	}

	get profileDir() {
		if (this.config.profileDir) return this.config.profileDir;
		if (process.env.IBM_LAB_PROFILE_DIR) return process.env.IBM_LAB_PROFILE_DIR;
		const root = join(this.home, "profiles");
		if (!existsSync(root)) return undefined;
		const candidates = readdirSync(root, { withFileTypes: true })
			.filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, "package.json")))
			.map(entry => join(root, entry.name))
			// 优先含 @ibm-lab 依赖的 profile；多个时取第一个（DSH 默认只有一个应用 profile）。
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

	async #readFlags() {
		if (!existsSync(this.flagsPath)) return { soft: {} };
		try {
			const parsed = JSON.parse(await readFile(this.flagsPath, "utf8"));
			return { soft: parsed?.soft ?? {} };
		} catch {
			return { soft: {} };
		}
	}

	async #writeFlags(flags) {
		await mkdir(join(this.home, "lab-agent"), { recursive: true });
		await writeFile(this.flagsPath, JSON.stringify(flags, null, 2) + "\n", "utf8");
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
		const flags = await this.#readFlags();
		const profile = this.#profile();
		const installed = new Set();
		if (profile) {
			for (const plugin of PLUGINS) {
				if (existsSync(join(profile.dir, "node_modules", ...plugin.package.split("/")))) installed.add(plugin.id);
			}
		}
		return {
			plugins: PLUGINS.map(plugin => ({
				...plugin,
				soft: flags.soft[plugin.id] !== false,
				hard: profile ? profile.bundles.includes(plugin.package) : false,
				installed: installed.has(plugin.id)
			})),
			profileDir: profile?.dir ?? null
		};
	}

	#validate(request) {
		const id = request?.id;
		if (!PLUGIN_IDS.has(id)) throw new Error(`未知子插件：${id ?? "(空)"}`);
		return id;
	}

	async setSoft(request = {}) {
		const id = this.#validate(request);
		const flags = await this.#readFlags();
		flags.soft[id] = request.enabled !== false;
		await this.#writeFlags(flags);
		return { ...(await this.list()), changed: id, restartRequired: false };
	}

	async setHard(request = {}) {
		const id = this.#validate(request);
		const profile = this.#profile();
		if (!profile) throw new Error("找不到可管理的 profile，无法修改插件装配");
		const plugin = PLUGINS.find(item => item.id === id);
		const wanted = request.enabled !== false;
		const bundles = profile.bundles.filter(name => name !== plugin.package);
		if (wanted) bundles.push(plugin.package);
		profile.manifest.dsh ??= {};
		profile.manifest.dsh.profile ??= {};
		profile.manifest.dsh.profile.bundles = bundles;
		await writeFile(profile.manifestPath, JSON.stringify(profile.manifest, null, 2) + "\n", "utf8");
		return { ...(await this.list()), changed: id, restartRequired: true };
	}
}

export class LabPluginSettingsService extends Service {
	constructor(ctx, config = {}) {
		super(ctx, "labPlugins");
		this.backend = new PluginSettingsBackend(config);
	}

	get home() { return this.backend.home; }
	list() { return this.backend.list(); }
	setSoft(request) { return this.backend.setSoft(request); }
	setHard(request) { return this.backend.setHard(request); }
}

export default LabPluginSettingsService;
