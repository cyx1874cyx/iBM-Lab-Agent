// dsh-lab-agent client 统一入口（esbuild bundle 入口点）。
// 顶层副作用：注入 CSS；随后 re-export apply 供 build-client.mjs 的 footer 组装。
import { injectStyles } from "./styles.js";
import { apply } from "./apply.js";

injectStyles();

export { apply };
export const inject = ["remote"];
