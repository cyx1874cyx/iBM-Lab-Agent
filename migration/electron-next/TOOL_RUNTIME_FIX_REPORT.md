# 修复工具调用时 prepare 未定义

日期：2026-10-05；产品修复提交 `ee96bfb`。固定 iBM 0.5.8-rc.1、NEXT v2.0.17-next、内核 0.2.0-rc.2、Electron 44.0.0 不变。本包替代此前设置加载修复包，包含其内部包身份修复。

## 根因与修复

用户在课题“测试”的会话里请求读取 v1 项目记忆，模型产生工具调用后报 `Cannot read properties of undefined (reading 'prepare')`。消息中的任务提示是故障上下文，本次没有读取、修改或运行实际用户课题。

离线包把 81 个依赖都独立解包进 profile，包括 22 个固定内核依赖。Agent loop 从应用目录导入 `@deepseek-ai/dsh-tools`，工具服务从 profile 的第二份模块导入同一个包。该包的 `TOOL_RUNTIME_SCHEDULER` 是进程局部 `Symbol(...)`，两份同版本、同字节的文件依然产生不同标识；因此 Agent loop 找不到工具服务上的 scheduler，调用 prepare 失败。

旧 bootstrap 的真实 Host 测试复现了完全相同的 TypeError。本次没有修改内核源码或把其 Symbol 改为全局标识。首次初始化仍验证全部 81 份归档；22 个同版本内核包统一指向应用中固定的物理模块，通过 Windows junction 共享。科研领域实现和其他离线依赖仍保留在 profile。

已初始化的同版本 home 每次启动也检查这一布局。旧内核副本移动到 `home/recovery/ibm-kernel-modules/repair-*`，建立新链接；链接建立失败则恢复刚移动的副本，不递归删除原文件。核对包名、版本及目录归属，不接受不兼容包。已经指向正确物理模块的链接保持原样；同位置覆盖安装无需重建 profile。科研数据库、课题文件、初始化标记及凭据不由该修复重写。

## 验证与边界

- 旧 bootstrap 的真实 Host：复现 prepare 未定义。证据保留在 `outputs/electron-next-tool-fix/old-reproducer`，不是修复后的失败。
- 新环境：Agent loop 所用 scheduler Symbol 与实际工具服务一致；通过真实 prepare/dispatch/finalize/finish 流程调用正式 `lab_project_memory_read`，返回测试课题记忆 v1 和版本历史。
- 复制此前测试包的独立 home：修复 22 个副本并备份，初始化标记哈希不变，既有 v1 记忆保持，工具读取与 Host 重启均通过。复制时省略自动生成的 NEXT bundle fallback，让原 loader 重建其 junction，避免 Windows 复制 junction 得到目录而干扰验证；原用户 home 未操作。
- 最终封装 payload：首次引导、桌面设置实际鼠标点击、课题面板实际鼠标点击及关闭/再打开通过。设置验证脚本增加等待并重试打开实际启动器，避免账号菜单尚未挂载时的一次空点击。
- 两项新增单元测试覆盖进程冷启动的 Symbol 身份统一、旧副本恢复备份、记忆保留、重复检查幂等和不兼容版本拒绝。
- 全量 806 项：798 通过、8 跳过、0 失败。受影响文件 ESLint 与 diff 检查通过，固定 NEXT checkout 无改动。

测试不使用实际账号、API 密钥或付费 LLM；工具准备与执行验证使用正式 Host 和工具实现，在专用测试 home 注册测试读取工具。它覆盖本次出错的内部工具调度链路，不等同于整段真实模型对话的外部验收。之前的 NSIS 安装/卸载证据继续保留，本轮测试最终 unpacked payload，未覆盖安装正在运行的用户应用。

## 交付

安装包：`outputs/electron-next-tool-fix/windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`，437,052,219 字节，未签名迁移测试版。

SHA-256：`4d64d10460221caf34a0b55982112d8abdab99df67853372fe0ad1fb516722a4`。

先从托盘退出新版，再安装到原位置。无需卸载或删除数据；下次启动自动处理旧重复依赖，然后在原会话重试失败的请求。历史课题自动迁移、原生保存对话框和完整工作流仍不计为通过。

重现：按 P6_REPRODUCE 构建，再运行 `verify-install-runtime.mjs --tool-probe --app <resources/app> --resources <resources> --electron <exe> --output <独立验证目录>`；`--previous-home <旧测试home>` 验证旧环境修复，`--legacy-bootstrap` 仅用于旧包失败重现。详细记录见 `TOOL_RUNTIME_FIX_VERIFICATION.json`。
