import { isAbsolute, join } from "node:path";
import { applicationSpec } from "../../lib/applications/registry.js";
import { GUARDIAN } from "./process-supervisor.js";

/** No executable/module/argv from a client. Installation controls the interpreter. */
export function nativeMcpConfig(appKey, { python, toolProfile = "compact", workspaceRoot }) {
 const spec = applicationSpec(appKey);
 if (!isAbsolute(python ?? "")) throw new Error("native MCP requires an absolute managed Python path");
 if (!["compact", "full"].includes(toolProfile)) throw new Error("unsupported Origin tool profile");
 if (workspaceRoot && !isAbsolute(workspaceRoot)) throw new Error("native MCP workspace must be absolute");
 return {
  transport: "stdio", serverName: spec.serverName, command: python,
  args: ["-I", GUARDIAN, python, "-I", "-m", spec.launch.module],
  ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
  env: appKey === "origin" ? { ORIGIN_MCP_TOOL_PROFILE: toolProfile } : {
   MNOVA_MCP_TIMEOUT_SEC: "90",
   ...(workspaceRoot ? { MNOVA_MCP_WORKSPACE: workspaceRoot, MNOVA_MCP_OUTPUT_ROOT: join(workspaceRoot, "mnova-output"), MNOVA_MCP_RUNTIME_ROOT: join(workspaceRoot, "mnova-runtime") } : {})
  },
  toolCallTimeoutMs: 120000, failOnStartupError: true, reconnect: { enabled: false }
 };
}
