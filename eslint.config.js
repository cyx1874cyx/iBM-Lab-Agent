/**
 * ESLint flat config（Doc2 工具链基础设施）。
 *
 * 落地说明（rc1 范围）：本配置文件 + .editorconfig/.prettierrc.json 入库；
 * eslint/@eslint/js/globals 作为 devDependencies 安装与 CI lint job 属于
 * 后续工程化步骤（依赖锁与发布窗口分开，避免 rc1 前的 lock churn）。届时：
 *   npm i -D eslint @eslint/js globals
 *   npm run lint
 *
 * 规则策略：历史大文件（lib/tasks.js 等）暂不强制执行风格规则；只开
 * “确定性正确性”类规则，杜绝未定义变量/明显死代码，控制为可修复噪声。
 */
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "vendor/**", "runtime/**", "desktop/**", "**/dist/**", "**/assets/**", "scripts/ketcher-shell/public/**", "**/*.d.ts"] },
  js.configs.recommended,
  {
    files: ["lib/**/*.js", "src/**/*.js", "scripts/**/*.mjs", "tests/**/*.mjs", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error"
    }
  },
  {
    files: ["client/**/*.js", "browser-extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, chrome: "readonly" }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  // 历史代码风格与 recommended 全集冲突的噪声规则：收敛为 off。
  // 保留"确定性正确性"核心（no-undef / no-unused-vars / no-dupe-keys 等）。
  {
    rules: {
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-regex-spaces": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off"
    }
  }
];
