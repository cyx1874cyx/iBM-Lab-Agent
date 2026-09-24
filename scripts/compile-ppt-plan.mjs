#!/usr/bin/env node
/**
 * PPT 计划编译 CLI：`node scripts/compile-ppt-plan.mjs --plan plan.json [--template <dir>|--slots slots.json] --out compiled.json`。
 *
 * 把 Agent 写的语义化 plan（角色 + 槽位内容）编译成构建器可直接执行的填充指令：
 *   角色 → 版式 id；槽位 → texts[]（prompt 优先 + idx 兜底 + mode/align/sizePt）。
 * 编译期报出必填槽缺失、槽位名写错、图片不存在、容量超限预警 —— 不必等构建完看渲染。
 *
 * 用法：
 *   node scripts/compile-ppt-plan.mjs --plan p.json --template /path/to/v2 --out compiled.json
 *   node scripts/compile-ppt-plan.mjs --plan p.json --slots /path/to/v2/slots.json --out compiled.json --json
 *
 * 参数：
 *   --plan FILE       输入 plan.json（必填）
 *   --template DIR    模板版本目录或 manifest 包目录（用它的 slots.json / manifest 派生规范）
 *   --slots FILE      直接给 slots.json（与 --template 二选一）
 *   --out FILE        输出 compiled.json（缺省写到 plan.json 同目录的 <stem>.compiled.json）
 *   --python PATH     派生规范时用的解释器（透传）
 *   --allow-missing-images  图片缺失降级为 warning（默认 error）
 *   --json            只输出 JSON（人类摘要写 stderr）
 *
 * 退出码：0 编译通过 / 1 有 error（compiled.json 仍会写出，便于对照修） / 2 用法或读取失败。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { cleanCompiledPlan, compilePlan } from "../lib/pptx-plan.js";
import { SLOTS_SPEC_FILE, readSlotSpec } from "../lib/ppt-template-lint.js";
import { loadManifestPackage, summarizeManifest } from "../lib/pptx-manifest.js";
import { deriveSlotSpec } from "../src/ppt-slot-spec.js";

const USAGE = `用法：node scripts/compile-ppt-plan.mjs --plan <plan.json> [--template <目录> | --slots <slots.json>] [--out <compiled.json>] [选项]
选项：--python PATH --allow-missing-images --json`;

class UsageError extends Error {}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--plan": options.plan = argv[++index]; break;
			case "--template": options.template = argv[++index]; break;
			case "--slots": options.slots = argv[++index]; break;
			case "--out": options.out = argv[++index]; break;
			case "--python": options.python = argv[++index]; break;
			case "--allow-missing-images": options.allowMissingImages = true; break;
			case "--json": options.json = true; break;
			case "--help": case "-h": options.help = true; break;
			default: throw new UsageError(arg.startsWith("--") ? `未知参数：${arg}` : `意外的位置参数：${arg}`);
		}
	}
	return options;
}

/** 从模板目录（版本目录或 manifest 包）得到槽位规范。 */
async function slotSpecFromTemplate(templateDir) {
	const dir = resolve(templateDir);
	const manifestDir = existsSync(join(dir, "manifest.yaml")) ? dir : join(dir, "manifest");
	const specFromFile = await readSlotSpec(existsSync(join(dir, SLOTS_SPEC_FILE))
		? join(dir, SLOTS_SPEC_FILE)
		: join(manifestDir, "..", SLOTS_SPEC_FILE));
	if (specFromFile !== undefined) return { slotSpec: specFromFile, source: "slots.json" };
	const pkg = await loadManifestPackage(manifestDir);
	if (!pkg.ok) {
		throw new UsageError(`${dir} 下既没有可用的 slots.json，也没有 pptx-cli manifest（${pkg.findings.map((finding) => finding.message).join("; ")}）`);
	}
	return {
		slotSpec: deriveSlotSpec(summarizeManifest(pkg.manifest), { templateRef: { name: pkg.manifest?.template?.name, sha256: pkg.manifest?.template?.source_hash } }),
		source: "manifest"
	};
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`${error.message}\n${USAGE}`);
		return 2;
	}
	if (options.help) { console.log(USAGE); return 0; }
	if (!options.plan) { console.error(`缺少 --plan\n${USAGE}`); return 2; }
	if (!options.template && !options.slots) { console.error(`需要 --template 或 --slots 之一来提供槽位规范\n${USAGE}`); return 2; }

	let plan;
	let slotSpec;
	let slotSource;
	try {
		plan = JSON.parse(await readFile(resolve(options.plan), "utf8"));
		if (options.slots) {
			slotSpec = await readSlotSpec(resolve(options.slots));
			if (slotSpec === undefined) throw new UsageError(`slots.json 不可读或不是 JSON 对象：${options.slots}`);
			slotSource = "slots.json";
		} else {
			const loaded = await slotSpecFromTemplate(options.template);
			slotSpec = loaded.slotSpec;
			slotSource = loaded.source;
		}
	} catch (error) {
		console.error(error instanceof UsageError ? error.message : `读取输入失败：${error.message}`);
		return 2;
	}

	const baseDir = dirname(resolve(options.plan));
	const { compiled, diagnostics, summary } = compilePlan({
		plan,
		slotSpec,
		baseDir,
		requireImages: options.allowMissingImages !== true
	});
	const outPath = options.out
		? resolve(options.out)
		: join(baseDir, `${basename(options.plan).replace(/\.json$/i, "")}.compiled.json`);
	const payload = compiled === undefined
		? { kind: "compiled-plan", schemaVersion: 1, ok: false, diagnostics }
		: { ...cleanCompiledPlan(compiled), ok: summary.ok };
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

	const lines = [
		`计划编译：${summary.ok ? "通过" : "有错误"}；error ${summary.errors}、warning ${summary.warnings}；槽位规范来源 ${slotSource}，共 ${compiled?.slides?.length ?? 0} 页。`
	];
	for (const row of diagnostics.slice(0, 20)) {
		const where = [row.location?.slide !== undefined ? `第 ${row.location.slide} 页` : undefined, row.location?.layoutId, row.location?.slotKey].filter(Boolean).join(" / ");
		lines.push(`- [${row.severity}] ${row.code}${where ? `（${where}）` : ""}：${row.message}`);
	}
	if (diagnostics.length > 20) lines.push(`- …另有 ${diagnostics.length - 20} 条，见 compiled.json`);
	lines.push(`产物：${outPath}`);

	if (options.json) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		process.stderr.write(`${lines.join("\n")}\n`);
	} else {
		console.log(lines.join("\n"));
	}
	return summary.ok ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => {
	console.error(`compile-ppt-plan 内部错误：${error.stack ?? error.message}`);
	process.exitCode = 2;
});
