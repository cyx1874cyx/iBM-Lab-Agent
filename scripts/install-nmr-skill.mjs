#!/usr/bin/env node
/**
 * @deprecated 0.2.0 起不再使用 —— 本脚本保留仅供旧文档追溯。
 *
 * 0.2.0 起 nmr-analyze-simulate 随 mnova-mcp 一起 vendor 化（vendor/mnova-mcp/
 * skill/nmr-analyze-simulate），不再需要从 GitHub raw 在线下载安装：
 *   * 桌面端：dsh.rs bootstrap 把打包 vendor 树物化到
 *     $DSH_HOME/lab-agent/vendor/，cordis.patch.yml 的
 *     lab-mnova-skill-filesystem provider 注册 nmr-analyze-simulate；
 *   * 远程部署：scripts/install.mjs 同样物化 vendor 树。
 * 运行本脚本会退出并提示改用上述物化路径。
 */

console.error(
  "[deprecated] install-nmr-skill.mjs 已弃用：0.2.0 起 nmr-analyze-simulate 随" +
  " mnova-mcp vendor 化，由 cordis.patch.yml 的 lab-mnova-skill-filesystem provider" +
  " 注册（$DSH_HOME/lab-agent/vendor/mnova-mcp/skill），桌面端 bootstrap /" +
  " scripts/install.mjs 自动物化，无需本脚本。"
);
process.exit(1);
