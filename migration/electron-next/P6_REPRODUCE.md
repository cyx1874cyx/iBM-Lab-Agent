# Windows 安装包重现

在实现仓库运行，使用固定 NEXT checkout、已有离线 Python 和 Node。以下命令中的 Node/Python 可换为对应本机绝对路径，依赖版本不可变更。

```powershell
node scripts/build-client.mjs
node scripts/migration/build-domain-packages.mjs
node scripts/migration/pack-domain-release.mjs --next-root H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next --python H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/python-resource/python.exe --output H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p6/release-archives-fixed
python -I scripts/migration/verify-release-archives.py H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p6/release-archives-fixed
python -I scripts/migration/verify-domain-archives.py --directory H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p6/release-archives-fixed
node scripts/migration/build-windows-installer.mjs --next-root H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next --python-resource H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/python-resource --archives H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p6/release-archives-fixed --output H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p6/windows-delivery
node --test 'tests/unit/*.test.mjs' 'tests/integration/*.test.mjs'
```

封装使用 builder 26.15.7、NSIS toolset 1.2.1；复制固定 Electron 44.0.0，不重新解析 npm 依赖。首次获取 builder 的官方工具二进制可能需要网络，安装后的首次运行依赖随包资源。

对 `win-unpacked` 或实际安装目录执行 `verify-install-runtime.mjs`，传入 `--app <resources/app>`、`--resources <resources>`、`--electron <程序exe>`、`--output <独立验证目录>`。`verify-installed-shell.mjs` 使用相同参数，但以 `--executable` 指定程序。两者新建独立科研 home，均不使用当前真实登录及课题。

静默安装必须使用 Windows 反斜杠绝对路径：`Setup.exe /S /currentuser /D=H:\...\专用安装目录`，`/D=` 必须位于最后且不单独加引号。验证目录须不存在，并检查没有其他该新版身份的安装；本次测试的卸载器只指向自己安装的目录。使用 `/S /currentuser` 卸载，检查该目录程序已移除、独立 home 及课题记忆仍存在。不要卸载旧版，不要对用户研究目录进行递归删除。

交付是未签名的迁移测试版本，P4/P5 未完成项目见 `P6_REPORT.md`。
