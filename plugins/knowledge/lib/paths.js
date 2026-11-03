/** 部署路径约定：与母插件共用 $DSH_HOME/lab-agent 布局，但不读取其代码。 */
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveDshHome(env = process.env) {
	return env.DSH_HOME || join(homedir(), ".dsh");
}

export function labAgentRoot(dshHome = resolveDshHome()) {
	return join(dshHome, "lab-agent");
}
