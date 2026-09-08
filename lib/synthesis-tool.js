/**
 * dsh-lab-agent: 合成路线工作台 Agent 工具（lab_synth_*）。
 *
 * 0.3.0 起课题面板已有「合成路线工作台」（synthesis_targets / synthesis_routes /
 * synthesis_evidence），remote RPC（synth_*）与 lib/synthesis.js 均已实现，
 * 但 Agent 会话工具注册层此前未暴露——本条补上与 lab_tasks_register_* 同层的
 * 可调用封装（P1 修复 #4），让 Agent 能把文献中的合成目标/路线/证据直接登记到
 * 课题并在面板可见：
 *
 *   - lab_synth_target_create    登记合成目标（CPTM、PEG-b-PCPTM52 等）
 *   - lab_synth_target_list      列出课题内目标
 *   - lab_synth_compound_resolve_first  登记路线前查询 PubChem/CACTUS 结构候选
 *   - lab_synth_route_create     登记合成路线（含起步/多步，origin 默认
 *                                literature-extracted）
 *   - lab_synth_route_step       追加路线步骤（仅 draft 可编辑）
 *   - lab_synth_evidence_add     登记字段级证据（supportsField/page/…）
 *   - lab_synth_route_status     推进状态机（draft→under-review→approved|rejected）
 *
 * 仅 draft 状态可编辑；审核为人工步骤（不自动执行合成，与 CAS 边界一致）。
 * projectId 解析与 lab_tasks_* 一致：显式传 → 会话绑定 → 会话 cwd。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveToolProjectId } from "./project-context.js";
import { cleanJson } from "../src/json-boundary.js";
import { buildPlanDraftFields } from "../src/synthesis/plan-draft.js";

export const name = "synthesis-tool";
export const inject = ["tools", "labTasks", "labSynthesis", "labChemistry", "labExperimentPlanTemplates"];

const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"];
const ROUTE_STATUSES = ["draft", "under-review", "approved", "rejected"];

/** 生成可入库 id（PROFILE_ID_RE: ^[a-z0-9][a-z0-9-]*$）。 */
function nextId(prefix) {
	return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 工具返回体必须是无损 JSON（Harness 会对 execute 输出做 snapshotJsonValue
 * 校验）。zod parse 会保留「显式传 undefined 的可选字段」为自有属性，导致
 * `value is not lossless JSON`——这里统一过 cleanJson 剔除 undefined 值属性
 * （与 lib/remote.js 的 synth_* RPC 出口同一模式）。
 */
function plainTarget(target) {
	const { createdAt, updatedAt, ...rest } = target;
	return cleanJson(rest);
}

const cleanName = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const nameKey = (value) => cleanName(value).toLocaleLowerCase("en-US");

/**
 * 路线登记的最后一道自动补全：不依赖 Agent 是否记得逐个调用查询工具。
 * 每个明确化合物只查询一次；合法 CAS 可独立采用，SMILES 采用首个命中来源。
 * 无需双源一致。用户或原文已提供的字段永不被覆盖。
 */
export async function enrichStepCompounds(step, resolveCompoundDual) {
	const supplied = Array.isArray(step?.structures) ? step.structures : [];
	const entries = new Map();
	const add = (name, role = "unknown", structure = {}) => {
		const normalized = cleanName(name);
		if (!normalized) return;
		const key = nameKey(normalized);
		const previous = entries.get(key);
		entries.set(key, previous
			? { ...previous, ...structure, role: structure.role || (previous.role === "unknown" && role !== "unknown" ? role : previous.role) }
			: { name: normalized, role, source: "agent", ...structure });
	};
	for (const name of (step?.reactants ?? [])) add(name, "reactant");
	for (const name of (step?.products ?? [])) add(name, "product");
	for (const name of (step?.reagents ?? [])) add(name, "reagent");
	for (const row of (step?.procedure?.reagents ?? [])) add(row?.name, "reagent");
	for (const row of (step?.procedure?.catalysts ?? [])) add(row?.name, "catalyst");
	for (const structure of supplied) add(structure?.name, structure?.role ?? "unknown", structure);

	await Promise.all([...entries.entries()].map(async ([key, entry]) => {
		if (entry.smiles && entry.casNumber) return;
		try {
			const result = await resolveCompoundDual(entry.casNumber || entry.name);
			const patch = {
				...(entry.casNumber || !result?.casNumber ? {} : { casNumber: result.casNumber }),
				verification: {
					status: result?.status ?? "unresolved",
					sources: [result?.sources?.pubchem?.smiles || result?.sources?.pubchem?.cid ? "pubchem" : null, result?.sources?.cactus?.smiles ? "cactus" : null].filter(Boolean),
					checkedAt: new Date().toISOString(),
					notes: "首次提交采用已命中来源；结构与 CAS 独立登记，未命中可后补"
				}
			};
			if (!entry.smiles && ["single-source", "dual-confirmed"].includes(result?.status) && result.smiles) {
				patch.smiles = result.smiles;
				if (result.inchiKey) patch.inchiKey = result.inchiKey;
				patch.source = result.source || "pubchem";
			}
			if (entry.smiles && entry.verification) patch.verification = entry.verification;
			entries.set(key, { ...entry, ...patch });
		} catch (error) {
			entries.set(key, { ...entry, verification: entry.verification || { status: "unresolved", sources: [], checkedAt: new Date().toISOString(), notes: `自动查询失败：${error?.message ?? error}` } });
		}
	}));
	return { ...step, structures: [...entries.values()] };
}

export function apply(ctx) {
	// ── 合成目标 ─────────────────────────────────────────────────────────────
	ctx.tools.register(defineTool({
		name: "lab_synth_target_create",
		description:
			"在课题「合成路线工作台」登记一个合成目标分子（synthesis_targets）。" +
			"name 必填（如 CPTM、PEG-b-PCPTM52）；可带 SMILES/分子式/实体引用/备注。" +
			"登记后目标在面板「合成路线工作台 → 目标列表」可见，可继续用 lab_synth_route_create 登记其路线。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			name: { type: "string", required: true, description: "目标分子名称（唯一展示名），如 CPTM" },
			smiles: { type: "string", description: "可选：目标分子 SMILES" },
			formula: { type: "string", description: "可选：分子式" },
			entityId: { type: "string", description: "可选：已登记化学实体 id（chemistry 域）" },
			notes: { type: "string", description: "可选：备注（来源、用途等）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					target: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `合成目标登记失败：${value.error ?? "未知错误"}` }];
				const t = value.target;
				return [{ type: "text", text: `已登记合成目标「${t.name}」（${t.id}${t.smiles ? `，SMILES: ${t.smiles}` : ""}）。可在课题面板「合成路线工作台」查看。` }];
			}
		},
		timeoutMs: 10000,
		async execute(args, exec) {
			try {
				const resolved = resolveToolProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const target = await ctx.labSynthesis.createTarget({
					id: nextId("target"),
					projectId: resolved.projectId,
					name: String(args.name).replace(/\s+/g, " ").trim(),
					smiles: args.smiles,
					formula: args.formula,
					entityId: args.entityId,
					notes: args.notes
				});
				return { ok: true, target: plainTarget(target) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_synth_target_list",
		description: "列出当前课题「合成路线工作台」已登记的合成目标（synthesis_targets），供 Agent 拿到 targetId 后登记路线。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					targets: {
						type: "array",
						items: { type: "object", additionalProperties: true }
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `目标读取失败：${value.error ?? "未知错误"}` }];
				if (!value.targets.length) return [{ type: "text", text: "当前课题暂无合成目标；可先用 lab_synth_target_create 登记。" }];
				const lines = value.targets.map((t) => `- ${t.id} | ${t.name}${t.formula ? `（${t.formula}）` : ""}${t.smiles ? ` SMILES: ${t.smiles}` : ""}`).join("\n");
				return [{ type: "text", text: `当前课题合成目标 ${value.targets.length} 个：\n${lines}` }];
			}
		},
		timeoutMs: 10000,
		async execute(args, exec) {
			try {
				const resolved = resolveToolProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const targets = ctx.labSynthesis.listTargets().filter((row) => row.projectId === resolved.projectId).map(plainTarget);
				return { ok: true, targets };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_synth_compound_resolve_first",
		description:
			"在登记合成路线前，按化合物名称或 CAS 主动查询 PubChem 与 CACTUS，返回可追溯的结构候选。" +
			"上传/提取路线时，只要反应物、产物、试剂或催化剂缺少 SMILES，就应逐一调用本工具；" +
			"single-source 命中即可写入步骤 structures，无须第二来源确认；未命中保留占位，禁止猜测结构。",
		parameters: {
			identifier: { type: "string", required: true, description: "化合物名称或合法 CAS 号；优先使用原文中的明确名称/CAS" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					result: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `结构查询失败：${value.error ?? "未知错误"}` }];
				const row = value.result;
				return [{ type: "text", text: `${args.identifier}：${row.status}${row.smiles ? `；SMILES ${row.smiles}` : "；未得到可自动采用的结构"}${row.casNumber ? `；CAS ${row.casNumber}` : ""}。` }];
			}
		},
		timeoutMs: 45000,
		async execute(args) {
			try {
				const identifier = String(args.identifier ?? "").replace(/\s+/g, " ").trim();
				if (!identifier) return { ok: false, error: "化合物名称或 CAS 不能为空" };
				return { ok: true, result: cleanJson(await ctx.labSynthesis.resolveCompoundFirst(identifier)) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// ── 合成路线 ─────────────────────────────────────────────────────────────
	ctx.tools.register(defineTool({
		name: "lab_synth_route_create",
		description:
			"为课题内一个合成目标登记一条合成路线（synthesis_routes，初始 draft）。" +
			"从文献/文件提取路线时，在写入前应对每个缺结构的明确化合物调用 lab_synth_compound_resolve_first，尽量补齐 SMILES、CAS 与来源；不得仅登记名称后停止。" +
			"推荐在 steps 里一次给出全部步骤（reaction 必填、按序 1..n），origin 默认 literature-extracted。" +
			"登记后路线在工作台可见；draft 态可继续用 lab_synth_route_step 追加/修改步骤。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			name: { type: "string", required: true, description: "路线展示名，如 “CPTM 四步合成路线”" },
			targetId: { type: "string", required: true, description: "合成目标 id（lab_synth_target_list / lab_synth_target_create 返回）" },
			origin: { type: "string", description: "可选：来源（默认 literature-extracted；human-edited/agent-optimized/retrosynthesis）" },
			steps: {
				type: "array",
				description: "可选：路线步骤数组（每步 reaction 必填、step 为 1-based 序号）；可后续用 lab_synth_route_step 追加",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						step: { type: "number" },
						label: { type: "string" },
						reaction: { type: "string", required: true },
						reactants: { type: "array", items: { type: "string" } },
						products: { type: "array", items: { type: "string" } },
						reagents: { type: "array", items: { type: "string" } },
						conditions: { type: "string" },
						structures: {
							type: "array",
						description: "可选：步骤化合物结构式条目；优先登记原文结构，并用双源查询尽量补齐明确化合物，无法确认时保留名称且不得猜测",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									name: { type: "string", required: true },
									smiles: { type: "string" },
									casNumber: { type: "string" },
									inchiKey: { type: "string" },
									role: { type: "string" },
									source: { type: "string" },
									verification: {
										type: "object",
										additionalProperties: false,
										properties: {
											status: { type: "string" },
											sources: { type: "array", items: { type: "string" } },
											checkedAt: { type: "string" },
											notes: { type: "string" }
										}
									}
								}
							}
						},
						evidenceIds: { type: "array", items: { type: "string" } },
						references: { type: "array", items: { type: "string" } }
					}
				}
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					route: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `合成路线登记失败：${value.error ?? "未知错误"}` }];
				const r = value.route;
				return [{ type: "text", text: `已登记合成路线「${r.name}」（${r.id}，目标 ${r.targetId}，${r.steps.length} 步，状态 ${r.status}）。可在课题面板「合成路线工作台 → 路线」查看。` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveToolProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const enrichedSteps = await Promise.all((args.steps ?? []).map((step, index) => enrichStepCompounds(
					{ step: step.step ?? index + 1, ...step },
					(identifier) => ctx.labSynthesis.resolveCompoundFirst(identifier)
				)));
				const route = await ctx.labSynthesis.createRoute({
					id: nextId("route"),
					projectId: resolved.projectId,
					targetId: args.targetId,
					name: String(args.name).replace(/\s+/g, " ").trim(),
					steps: enrichedSteps,
					version: 1,
					origin: args.origin ?? "literature-extracted"
				});
				return { ok: true, route: cleanJson({ id: route.id, targetId: route.targetId, name: route.name, status: route.status, steps: route.steps, version: route.version, origin: route.origin }) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_synth_route_step",
		description: "给一条 draft 合成路线追加一步（reaction 必填）。写入前应对缺结构的明确化合物调用 lab_synth_compound_resolve_first，尽量补齐 structures；状态非 draft 时拒绝。",
		parameters: {
			routeId: { type: "string", required: true, description: "合成路线 id（lab_synth_route_create 返回）" },
			reaction: { type: "string", required: true, description: "该步反应描述，如 “RAFT 聚合（PEG-PCPTM 大分子引发剂）”" },
			label: { type: "string", description: "可选：步骤短名，如 “RAFT 聚合”" },
			reactants: { type: "array", items: { type: "string" }, description: "可选：底物（显示名或 SMILES）" },
			products: { type: "array", items: { type: "string" }, description: "可选：产物" },
			reagents: { type: "array", items: { type: "string" }, description: "可选：试剂" },
			conditions: { type: "string", description: "可选：条件摘要（原文格式）" },
			structures: {
				type: "array",
				description: "可选：本步化合物结构式条目 [{name, smiles?, role?, source?}]；文献 SI/正文给 SMILES 时登记，缺失留待 PubChem 解析/Ketcher 补绘（面板显示待补绘）",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						name: { type: "string", required: true },
						smiles: { type: "string", description: "可选：SMILES（缺失=待补绘）" },
						casNumber: { type: "string", description: "可选：经原文或双源确认的 CAS 号" },
						inchiKey: { type: "string", description: "可选：双源结构比对得到的 InChIKey" },
						role: { type: "string", description: "可选：reactant/product/reagent/catalyst/unknown" },
						source: { type: "string", description: "可选：agent/pubchem/manual/entity，默认 agent" },
						verification: {
							type: "object",
							additionalProperties: false,
							properties: {
								status: { type: "string" },
								sources: { type: "array", items: { type: "string" } },
								checkedAt: { type: "string" },
								notes: { type: "string" }
							}
						}
					}
				}
			},
			evidenceIds: { type: "array", items: { type: "string" }, description: "可选：支撑该步的证据 id（lab_synth_evidence_add 返回）" },
			references: { type: "array", items: { type: "string" }, description: "可选：文献引用（DOI/专利号）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					route: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `步骤追加失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已向路线 ${args.routeId} 追加第 ${value.route.steps.length} 步（${args.reaction}）。可继续追加或调用 lab_synth_route_status 提交审核。` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const route = ctx.labSynthesis.getRoute(args.routeId);
				const enrichedStep = await enrichStepCompounds({
					step: route.steps.length + 1,
					label: args.label,
					reaction: String(args.reaction).trim(),
					reactants: args.reactants ?? [],
					products: args.products ?? [],
					reagents: args.reagents ?? [],
					conditions: args.conditions,
					structures: args.structures ?? [],
					evidenceIds: args.evidenceIds ?? [],
					references: args.references ?? []
				}, (identifier) => ctx.labSynthesis.resolveCompoundFirst(identifier));
				const routeWithStep = await ctx.labSynthesis.addRouteStep(args.routeId, enrichedStep);
				return { ok: true, route: cleanJson({ id: routeWithStep.id, status: routeWithStep.status, steps: routeWithStep.steps }) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_synth_experiment_plan_create",
		description: "根据已登记合成路线及其文献证据生成并登记实验计划草案。生成前读取当前实验计划模板；结果带 routeId、requiresReview=true，并显示在课题研究设计面板。",
		parameters: {
			routeId: { type: "string", required: true, description: "合成路线 id" },
			scale: { type: "string", description: "可选：实验规模；缺省明确标为待确认" },
			extraSafety: { type: "array", items: { type: "string" }, description: "可选：由 Agent 根据化合物性质补充、且需人工复核的安全注意事项" }
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true }, error: { type: "string" }, plan: { type: "object", additionalProperties: true } } },
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `实验计划登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已生成并登记实验计划「${value.plan.title}」（${value.plan.id}，待人工审核）。可在课题面板打开。` }];
			}
		},
		timeoutMs: 30000,
		async execute(args) {
			try {
				const route = ctx.labSynthesis.getRoute(args.routeId);
				const target = ctx.labSynthesis.getTarget(route.targetId) ?? null;
				const fields = buildPlanDraftFields(route, target, { evidence: ctx.labSynthesis.listRouteEvidence(route.id), scale: args.scale, extraSafety: args.extraSafety });
				let id = `plan-${route.id}`;
				let suffix = 1;
				while (ctx.labChemistry.getExperimentPlan(id) !== undefined) id = `plan-${route.id}-${++suffix}`;
				let templateSnapshot;
				const template = await ctx.labExperimentPlanTemplates.resolve("experiment-plan-default").catch(() => undefined);
				if (template) templateSnapshot = { id: template.id, version: template.version, name: template.name, sections: template.sections };
				const plan = await ctx.labChemistry.createExperimentPlan({ id, routeId: route.id, ...fields, ...(templateSnapshot ? { templateSnapshot } : {}) });
				return { ok: true, plan: cleanJson(plan) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// ── 字段级证据 ───────────────────────────────────────────────────────────
	ctx.tools.register(defineTool({
		name: "lab_synth_evidence_add",
		description:
			"给合成路线/步骤登记一条字段级证据（synthesis_evidence），回答“这个温度/当量/步骤从哪来”。" +
			"supportsField 与 sourceName 必填；建议带 sourceType（默认 paper-si）、页码/图表/摘录与 confidence，做文献提取路线时逐条登记，面板字段溯源即点亮。",
		parameters: {
			routeId: { type: "string", required: true, description: "合成路线 id" },
			stepId: { type: "string", description: "可选：步骤 id（s{序号} 或步骤序号数字）" },
			supportsField: { type: "string", required: true, description: "支撑字段，如 procedure.temperature / procedure.reagents / 步骤可行性" },
			sourceType: { type: "string", description: "可选：证据来源分层，默认 paper-si（paper-si/paper-main/cited-method/similar-literature/patent/reaction-db/compound-db/internal/model-inference）" },
			sourceTier: { type: "number", description: "可选：证据等级 1–5（1 最强），默认 5" },
			sourceName: { type: "string", required: true, description: "来源名称（如 期刊缩写、文献名、数据库名）" },
			title: { type: "string", description: "可选：文献题名" },
			doi: { type: "string", description: "可选：文献 DOI/专利号" },
			documentId: { type: "string", description: "可选：原文文献文档 id（自由文本，兼容保留）" },
			bundleId: { type: "string", description: "可选：已归档原文的 bundle id（课题文献条目；填写后审核抽屉可直接打开 PDF/SI 并按引文定位）" },
			page: { type: "string", description: "可选：页码" },
			figure: { type: "string", description: "可选：图号（如 Figure 2a / Scheme 1）" },
			table: { type: "string", description: "可选：表号" },
			excerpt: { type: "string", description: "可选：原文摘录" },
			relation: { type: "string", description: "可选：supports（默认）| conflicts | context" },
			confidence: { type: "string", description: "可选：high | medium | low | unknown（默认 unknown）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					evidence: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `证据登记失败：${value.error ?? "未知错误"}` }];
				const e = value.evidence;
				return [{ type: "text", text: `已登记证据 ${e.id}（route ${e.routeId}${e.stepId ? ` / step ${e.stepId}` : ""}，支撑字段 ${e.supportsField}，来源 ${e.sourceName}${e.page ? ` p.${e.page}` : ""}）。` }];
			}
		},
		timeoutMs: 10000,
		async execute(args, exec) {
			try {
				const evidence = await ctx.labSynthesis.addStepEvidence({
					routeId: args.routeId,
					stepId: args.stepId,
					supportsField: args.supportsField,
					sourceType: args.sourceType ?? "paper-si",
					sourceTier: args.sourceTier ?? 5,
					sourceName: args.sourceName,
					title: args.title,
					doi: args.doi,
					documentId: args.documentId,
					bundleId: args.bundleId,
					page: args.page,
					figure: args.figure,
					table: args.table,
					excerpt: args.excerpt,
					relation: args.relation ?? "supports",
					confidence: args.confidence ?? "unknown"
				});
				return { ok: true, evidence: cleanJson(evidence) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// ── 状态推进 ─────────────────────────────────────────────────────────────
	ctx.tools.register(defineTool({
		name: "lab_synth_route_status",
		description:
			"推进合成路线状态机（draft→under-review→approved|rejected）。审核为人工判断：" +
			"Agent 登记完成、证据齐备后可提交 under-review 供用户审阅；approved 由用户在面板人工确认。",
		parameters: {
			routeId: { type: "string", required: true, description: "合成路线 id" },
			status: { type: "string", required: true, description: `目标状态：${ROUTE_STATUSES.join(" | ")}` }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					route: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `状态更新失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `路线 ${args.routeId} 状态 → ${value.route.status}。可在课题面板「合成路线工作台」查看并人工审核。` }];
			}
		},
		timeoutMs: 10000,
		async execute(args, exec) {
			try {
				if (!ROUTE_STATUSES.includes(args.status)) return { ok: false, error: `invalid status '${args.status}'（支持 ${ROUTE_STATUSES.join("|")}）` };
				const route = await ctx.labSynthesis.updateRouteStatus(args.routeId, args.status);
				return { ok: true, route: cleanJson({ id: route.id, status: route.status }) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}

export default apply;
