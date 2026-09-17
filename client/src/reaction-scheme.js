import { STEP_FIELD_DEFS } from "./constants.js";
import { readStepFieldValue, stepIsStructured } from "./ketcher.js";

function textWeight(value) {
	return [...String(value || "")].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1.7 : 1), 0);
}

function clipText(value, maxWeight = 48) {
	const input = String(value || "").replace(/\s+/g, " ").trim();
	if (!input || textWeight(input) <= maxWeight) return input;
	let output = "";
	for (const char of input) {
		if (textWeight(output + char + "…") > maxWeight) break;
		output += char;
	}
	return `${output.trim()}…`;
}

/** 将步骤条件压缩为论文反应式中的三行条件与一行结果信息。 */
export function reactionSchemeConditions(step) {
	if (!stepIsStructured(step)) {
		return { above: step?.conditions ? [clipText(step.conditions, 62)] : ["反应条件待核验"], below: "" };
	}
	const values = Object.fromEntries(STEP_FIELD_DEFS.map((def) => [def.key, readStepFieldValue(step, def)]));
	const above = [
		[values.reagents, values.catalysts].filter(Boolean).join(" · "),
		[values.solvents, values.concentration].filter(Boolean).join(" · "),
		[values.temperature, values.time, values.atmosphere].filter(Boolean).join(" · ")
	].filter(Boolean).map((line) => clipText(line, 62));
	return {
		above: above.length ? above : ["反应条件待核验"],
		below: values.yield ? clipText(`收率 ${values.yield}`, 44) : ""
	};
}

function nodeWidth(entry) {
	const nameWeight = Math.min(30, textWeight(entry?.name || "结构待补绘"));
	return Math.max(146, Math.round(118 + nameWeight * 2.1));
}

function buildGroup(entries, fallbackNames, role) {
	const source = entries.length
		? entries
		: [{ name: (fallbackNames || []).join("、") || (role === "reactant" ? "反应物待补" : "产物待补"), role, placeholder: true }];
	return source.map((entry, index) => ({
		entry,
		key: `${role}-${entry?.id || entry?.name || index}-${index}`,
		width: nodeWidth(entry),
		height: 112
	}));
}

/** 计算统一 SVG 的确定性布局；所有可见元素共享一个坐标系。 */
export function buildReactionSchemeLayout({ reactants = [], products = [], reactantNames = [], productNames = [], conditions = { above: [], below: "" } } = {}) {
	const paddingX = 22;
	const structureY = 70;
	const labelY = 197;
	const arrowY = 126;
	const itemGap = 28;
	const sideGap = 22;
	const left = buildGroup(reactants, reactantNames, "reactant");
	const right = buildGroup(products, productNames, "product");
	const place = (items, startX) => {
		let x = startX;
		const nodes = items.map((item, index) => {
			const node = { ...item, x, y: structureY, labelY };
			x += item.width;
			if (index < items.length - 1) x += itemGap;
			return node;
		});
		return { nodes, endX: x };
	};
	const leftPlaced = place(left, paddingX);
	const longestCondition = Math.max(0, ...(conditions.above || []).map(textWeight), textWeight(conditions.below));
	// 总览不承载条件文本，箭头压缩为旧尺寸的一半；保留条件参数仅供布局单测与兼容调用。
	const arrowWidth = Math.max(75, Math.min(142, Math.round(52 + longestCondition * 1.55)));
	const arrowStart = leftPlaced.endX + sideGap;
	const arrowEnd = arrowStart + arrowWidth;
	const rightPlaced = place(right, arrowEnd + sideGap);
	return {
		width: rightPlaced.endX + paddingX,
		height: 222,
		arrow: { x1: arrowStart, x2: arrowEnd, y: arrowY, centerX: (arrowStart + arrowEnd) / 2 },
		conditions,
		nodes: [...leftPlaced.nodes, ...rightPlaced.nodes],
		plusSigns: [...leftPlaced.nodes.slice(0, -1), ...rightPlaced.nodes.slice(0, -1)].map((node, index) => ({ key: `plus-${index}-${node.key}`, x: node.x + node.width + itemGap / 2, y: arrowY }))
	};
}

export function reactionSchemeLabel(value, maxWeight = 30) {
	return clipText(value, maxWeight);
}
