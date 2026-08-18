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
			"读 PDF/Office 文档前**必须先用本工具转换**，再读取返回的 Markdown 文件；" +
			"不要自行编写 PDF/Office 解析脚本。转换出的 Markdown 可直接作为精读/翻译的输入源。",
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
				if (!value.ok) return `文档转换失败：${value.error ?? "未知错误"}`;
				return `已转换为 Markdown：${value.mdPath}\n\n${value.preview}`;
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
				return { ok: false, mdPath: "", error: error.message };
			}
		}
	}));
}

export const Config = undefined;
