/**
 * dsh-lab-agent: 文档转换模型工具（lab_convert_document）。
 *
 * 让 agent 读 PDF / Office（docx/pptx/xlsx）时**默认调用本工具**转换
 * Markdown（markitdown），而不是自行编写解析脚本——lab-research 预设的
 * persona 强制规则配套工具。挂载在 preset（lab-research）的工具层。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "convert-document";
export const inject = ["tools", "labConvert"];

export function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "lab_convert_document",
		description:
			"把 PDF / Office（docx/pptx/xlsx）等文档转换为 Markdown（基于 markitdown）。" +
			"这是 nature skills 的 PDF/Office 预处理耦合点：nature-reader、nature-paper-card、" +
			"nature-academic-search 等 skill 处理 PDF/Office 输入时，**必须先调用本工具**把文档" +
			"转成 Markdown，再用生成的 .md 作为该 skill 的输入源（精读/翻译/建卡/做 PPT 都从这份" +
			"Markdown 出发）。" +
			"禁止：自行编写 PDF/Office 解析脚本（pdfplumber/pypdf/python-docx 等），" +
			"或照抄 nature skill 中自写解析脚本的提取步骤——那部分一律由本工具完成。" +
			"返回 { ok, mdPath, preview }；markitdown 不可用时返回错误与安装指引。",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "要转换的文档绝对路径（.pdf/.docx/.pptx/.xlsx/.jpg 等）"
			},
			output: {
				type: "string",
				description: "可选：输出 .md 路径；缺省自动生成到 converted 目录"
			},
			previewChars: {
				type: "number",
				description: "返回预览字符数（默认 2000）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					mdPath: { type: "string", required: true },
					preview: { type: "string", required: true },
					error: { type: "string" }
				}
			},
			render(args, value) {
				// render 契约：返回 ContentBlock[]（{type:"text",text}），不能返回 string
				if (!value.ok) return [{ type: "text", text: `文档转换失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已转换为 Markdown：${value.mdPath}\n\n${value.preview}` }];
			}
		},
		timeoutMs: 180000,
		async execute(args) {
			try {
				const result = await ctx.labConvert.convertToMarkdown({
					path: args.path,
					fileName: args.path.split(/[\\/]/).pop()
				});
				const previewChars = args.previewChars ?? 2000;
				return {
					ok: true,
					mdPath: result.run.mdPath,
					preview: (result.text ?? "").slice(0, previewChars)
				};
			} catch (error) {
				return { ok: false, mdPath: "", preview: "", error: error.message };
			}
		}
	}));
}

export const Config = undefined;
