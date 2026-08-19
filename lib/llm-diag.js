/**
 * dsh-lab-agent: LLM 请求诊断（lab-llm-diag）。
 *
 * 监听 `llm/stream` waterfall，记录每次流式请求的失败（含 cause）到
 * `$DSH_HOME/lab-agent/llm-errors.log`，用于定位 "DeepSeek API stream
 * failed"（TRANSPORT）等传输层错误的真实原因（keep-alive 半死连接、
 * 超时、网络重置等）。本身不修改请求行为。
 */

import { Service } from "@deepseek-ai/cordis";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDshHome, labAgentRoot } from "../src/paths.js";

export class LabLlmDiagService extends Service {
	static inject = ["llm"];
	constructor(ctx, config = {}) {
		super(ctx, "labLlmDiag");
		this.logPath = config.logPath ?? join(labAgentRoot(resolveDshHome()), "llm-errors.log");
		this.ctx = ctx;
	}

	async [Service.init]() {
		await mkdir(dirname(this.logPath), { recursive: true });
		this.ctx.on("llm/stream", (options, next) => this.wrap(options, next));
	}

	async log(line) {
		try {
			await appendFile(this.logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
		} catch (error) {
			// 诊断日志失败不影响业务
		}
	}

	async *wrap(options, next) {
		const started = Date.now();
		const provider = options?.provider;
		const model = options?.model;
		let chunks = 0;
		let failure = null;
		try {
			for await (const chunk of next()) {
				chunks++;
				if (chunk?.type === "finish" && chunk?.reason?.kind === "error") {
					failure = chunk.reason.failure ?? chunk.reason.error ?? null;
				}
				yield chunk;
			}
		} catch (error) {
			failure = {
				message: error?.message ?? String(error),
				code: error?.code ?? "unknown",
				cause: error?.cause?.message ?? String(error?.cause ?? error)
			};
			await this.log(`FAILED provider=${provider} model=${model} chunks=${chunks} ms=${Date.now() - started} failure=${JSON.stringify(failure)}`);
			throw error;
		}
		if (failure !== null) {
			await this.log(`STREAM_ERROR provider=${provider} model=${model} chunks=${chunks} ms=${Date.now() - started} failure=${JSON.stringify(failure)}`);
		}
	}
}

export default LabLlmDiagService;
