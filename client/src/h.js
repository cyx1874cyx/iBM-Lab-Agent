// React 绑定：h = React.createElement。
// React 是 DSH ModuleLoader 的外部依赖（factory 的 require 参数提供），
// 这里直接 import，esbuild bundle 时标 external，运行时由 factory 解析。
import React from "react";

export const h = React.createElement;
export default h;
