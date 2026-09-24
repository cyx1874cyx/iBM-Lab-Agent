#!/usr/bin/env node
/**
 * PPT 模板体检 CLI：`node scripts/lint-ppt-template.mjs <templateId|path>`。
 *
 * 为什么要有独立命令而不只放在 Agent 工具里：
 *   * 仓库维护者改模板/改规范时要能**在命令行复现**同一份报告；
 *   * 出包前的 preflight、以及「模板导入后自动体检」都调它，保证只有一份判定逻辑
 *     （规则实现全在 lib/ppt-template-lint.js）。
 *
 * 用法：
 *   node scripts/lint-ppt-template.mjs tpl-ustc                              # 按 id 找最新版本
 *   node scripts/lint-ppt-template.mjs tpl-ustc --version 2
 *   node scripts/lint-ppt-template.mjs /path/to/v2                           # 模板版本目录
 *   node scripts/lint-ppt-template.mjs /path/to/v2 --baseline /path/to/v1     # 与上一版比静态层漂移
 *   node scripts/lint-ppt-template.mjs tpl-ustc --baseline tpl-ustc@1 --write-slots
 *
 * 参数：
 *   --templates-dir DIR   模板根目录（缺省 $DSH_HOME/lab-agent/templates）
 *   --version N           指定版本（缺省取最大 vN）
 *   --baseline PATH|ID@V  基线（上一版）：静态层漂移 + pptx-cli manifest diff
 *   --baseline-slots FILE 基线 slots.json（槽位改名/删除对比）
 *   --out DIR             lint.json 输出目录（缺省写模板版本目录）
 *   --min-font-pt N       字号下限（缺省 20）
 *   --python PATH         指定解释器（缺省走统一 resolver：bundled/venv/系统）
 *   --write-slots         顺便把派生的 slots.json 写到模板版本目录（缺省不写）
 *   --no-cli              跳过 pptx-cli doctor 调用
 *   --json                只输出 JSON（人类摘要写到 stderr）
 *   --fail-on error|none  退出码策略（缺省 error）
 *
 * 退出码：0 通过（无"必须修"的 error）/ 1 有必须修的 error / 2 用法或读取失败。
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
	SLOTS_SPEC_FILE,
	humanSummary,
	lintTemplatePackage,
	readSlotSpec,
	writeLintReport
} from "../lib/ppt-template-lint.js";
import { probePptxCli } from "../lib/pptx-manifest.js";
import { labAgentRoot, resolveDshHome } from "../src/paths.js";

const USAGE = `用法：node scripts/lint-ppt-template.mjs <templateId|path> [选项]
选项：--templates-dir DIR --version N --baseline PATH|ID@V --baseline-slots FILE
      --out DIR --min-font-pt N --python PATH --write-slots --no-cli --json
      --fail-on error|none`;

function parseArgs(argv) {
	const options = { positional: [], failOn: "error" };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--templates-dir": options.templatesDir = argv[++index]; break;
			case "--version": options.version = argv[++index]; break;
			case "--baseline": options.baseline = argv[++index]; break;
			case "--baseline-slots": options.baselineSlots = argv[++index]; break;
			case "--out": options.out = argv[++index]; break;
			case "--min-font-pt": options.minFontPt = Number(argv[++index]); break;
			case "--python": options.python = argv[++index]; break;
			case "--fail-on": options.failOn = argv[++index]; break;
			case "--write-slots": options.writeSlots = true; break;
			case "--no-cli": options.noCli = true; break;
			case "--json": options.json = true; break;
			case "--help": case "-h": options.help = true; break;
			default:
				if (arg.startsWith("--")) throw new UsageError(`未知参数：${arg}`);
				options.positional.push(arg);
		}
	}
	if (options.failOn !== "error" && options.failOn !== "none") throw new UsageError(`--fail-on 只能是 error 或 none（收到 ${options.failOn}）`);
	if (options.minFontPt !== undefined && (!Number.isFinite(options.minFontPt) || options.minFontPt <= 0)) {
		throw new UsageError(`--min-font-pt 必须是正数（收到 ${options.minFontPt}）`);
	}
	return options;
}

class UsageError extends Error {}

/** 模板根目录：显式参数 > $DSH_HOME/lab-agent/templates。 */
function templatesDirOf(options) {
	return options.templatesDir ? resolve(options.templatesDir) : join(labAgentRoot(resolveDshHome()), "templates");
}

/** 目录里最大的 vN 版本目录（返回版本号字符串）。 */
async function latestVersionOf(dir) {
	let entries = [];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return undefined;
	}
	const versions = entries
		.filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
		.map((entry) => entry.name.slice(1))
		.sort((a, b) => Number(a) - Number(b));
	return versions.at(-1);
}

/**
 * 把 `<templateId|path>` 解析成 `{versionDir, manifestDir, id, version}`。
 * 支持三种形态：模板版本目录 / manifest 包目录 / 模板 id。
 */
async function resolveTarget(target, options) {
	if (existsSync(target)) {
		const dir = resolve(target);
		if (existsSync(join(dir, "manifest", "manifest.yaml"))) {
			return { versionDir: dir, manifestDir: join(dir, "manifest"), id: basename(dir), version: (/(^|\/)v(\d+)$/.exec(dir) ?? [])[2] };
		}
		if (existsSync(join(dir, "manifest.yaml"))) {
			return { versionDir: dir.replace(/[\\/]manifest$/, ""), manifestDir: dir, id: basename(dir), version: undefined };
		}
		throw new UsageError(`${dir} 下没有 manifest.yaml，也不是模板版本目录（应含 manifest/ 或自身就是 manifest 包）`);
	}
	if (/[\\/]/.test(target) || isAbsolute(target)) {
		throw new UsageError(`路径不存在：${target}`);
	}
	const templatesDir = templatesDirOf(options);
	const version = options.version ?? await latestVersionOf(join(templatesDir, target));
	if (version === undefined) throw new UsageError(`模板 ${target} 在 ${templatesDir} 下没有 vN 版本目录`);
	const versionDir = join(templatesDir, target, `v${version}`);
	const manifestDir = existsSync(join(versionDir, "manifest", "manifest.yaml")) ? join(versionDir, "manifest") : versionDir;
	if (!existsSync(join(manifestDir, "manifest.yaml"))) {
		throw new UsageError(`${versionDir} 下没有 pptx-cli manifest（先执行模板导入；若 pptx-cli 不可用则只能走 parse.json 降级路径）`);
	}
	return { versionDir, manifestDir, id: target, version };
}

/** 基线参数 → manifest 目录（支持 ID@V 与路径）。 */
async function resolveBaseline(value, options) {
	if (!value) return undefined;
	const at = /^([^\\/@]+)@(\d+)$/.exec(value);
	if (at) {
		const dir = join(templatesDirOf(options), at[1], `v${at[2]}`, "manifest");
		if (!existsSync(join(dir, "manifest.yaml"))) throw new UsageError(`基线 manifest 不存在：${dir}`);
		return dir;
	}
	const target = await resolveTarget(value, options);
	return target.manifestDir;
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`${error.message}\n${USAGE}`);
		return 2;
	}
	if (options.help || options.positional.length === 0) {
		console.log(USAGE);
		return options.help ? 0 : 2;
	}
	if (options.positional.length > 1) {
		console.error(`只接受一个模板参数，收到 ${options.positional.length} 个\n${USAGE}`);
		return 2;
	}
	let target;
	let baselineDir;
	try {
		target = await resolveTarget(options.positional[0], options);
		baselineDir = await resolveBaseline(options.baseline, options);
	} catch (error) {
		console.error(error.message);
		return 2;
	}

	const cli = {};
	if (options.python) cli.python = options.python;
	const probe = await probePptxCli(cli);
	const baselineSlots = options.baselineSlots
		? await readSlotSpec(options.baselineSlots)
		: (baselineDir ? await readSlotSpec(join(baselineDir, "..", SLOTS_SPEC_FILE)) : undefined);

	const report = await lintTemplatePackage({
		manifestDir: target.manifestDir,
		template: {
			id: target.id,
			version: target.version,
			pptxCliVersion: probe.available ? probe.version : undefined
		},
		baselineManifestDir: baselineDir,
		baselineSlotSpec: baselineSlots,
		minFontPt: options.minFontPt,
		runCliChecks: options.noCli !== true,
		cli
	});
	report.template.python = probe.python;
	report.template.pythonSource = probe.pythonSource;
	report.template.cliAvailable = probe.available;
	report.humanSummary = humanSummary(report);

	const outDir = options.out ? resolve(options.out) : target.versionDir;
	await mkdir(outDir, { recursive: true });
	const lintPath = await writeLintReport(outDir, report);
	if (options.writeSlots) {
		const { deriveSlotSpec } = await import("../src/ppt-slot-spec.js");
		const { loadManifestPackage, summarizeManifest } = await import("../lib/pptx-manifest.js");
		const pkg = await loadManifestPackage(target.manifestDir);
		if (pkg.ok) {
			const spec = deriveSlotSpec(summarizeManifest(pkg.manifest), { minFontPt: options.minFontPt ?? 20 });
			await writeFile(join(outDir, SLOTS_SPEC_FILE), `${JSON.stringify(spec, null, 2)}\n`, "utf8");
		}
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		process.stderr.write(`${report.humanSummary}\n\n报告：${lintPath}\n`);
	} else {
		console.log(report.humanSummary);
		console.log(`报告：${lintPath}`);
		if (!probe.available) console.log(`提示：${probe.hint}`);
	}
	if (options.failOn === "none") return 0;
	return report.ok ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => {
	console.error(`lint-ppt-template 内部错误：${error.stack ?? error.message}`);
	process.exitCode = 2;
});
