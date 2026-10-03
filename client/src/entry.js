// dsh-lab-agent client 统一入口（esbuild bundle 入口点）。
// 样式随 apply 生命周期管理；模块缓存后重新启用也会恢复样式。
import { apply } from "./apply.js";

export { apply };
export const inject = ["remote"];
