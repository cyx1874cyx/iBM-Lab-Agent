/** Mount the desktop Origin stdio client in the research preset's tool scope.
 * Bridge availability is checked by tools, not by catalog registration.
 */
import { mkdir } from "node:fs/promises";
import * as mcp from "@deepseek-ai/dsh-mcp-client";
import { isDesktopShell } from "./capabilities.js";

export const name = "lab-origin-mcp";
export const inject = ["tools", "ibmRuntime"];

export async function apply(ctx) {
 if (!isDesktopShell()) return;
 const config = ctx.ibmRuntime.mcpConfig("origin", { toolProfile: "full" });
 if (config.cwd) await mkdir(config.cwd, { recursive: true });
 const validated = mcp.Config["~standard"].validate(config);
 if (validated.issues) throw new Error("Invalid managed Origin MCP configuration: " + JSON.stringify(validated.issues));
 // Await initial tools/list before Cordis declares this preset ready. Reuse
 // MCP lifecycle effects on this context so disposal removes tools/workers.
 await mcp.apply(ctx, validated.value);
}
