"""Freeze the P0 source baseline; never install, build, or read user data."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

IB_VERSION = "0.5.8-rc.1"
IB_COMMIT = "a400ac424e1ca89496a9ac706531d7a05a221a2d"
NEXT_COMMIT = "838ba60fd79362087c0a0d134efee671c284786a"
CORE_COMMIT = "639ed015397290b3745d163aafe02ffee4aa3f84"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "migration" / "electron-next"
OWNERS = {
    "labAgent": "core", "labTasks": "core/compatibility", "labArtifactDownload": "core",
    "labVersions": "runtime", "labPython": "runtime", "labLlmDiag": "runtime",
    "labNoteTemplates": "documents", "labTemplates": "documents",
    "labConvert": "documents", "labPdfViewerAssets": "documents",
    "labGoals": "literature", "labLiterature": "literature",
    "labCapture": "literature", "labCaptureHandoff": "literature",
    "labChemistry": "design", "labSynthesis": "design",
    "labExperimentPlanTemplates": "design", "labKetcherAssets": "design",
    "labEvidenceShot": "design", "labUserAction": "design",
    "labNmr": "analysis", "labPlotRecords": "analysis",
    "labCharacterization": "analysis", "lab": "compatibility",
}

def run(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)

def text(root, commit, path):
    return run(root, "show", f"{commit}:{path}").decode("utf-8-sig")

def obj(root, commit, path):
    return json.loads(text(root, commit, path))

def pretty(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"

def file_pin(root, commit, path):
    raw = run(root, "show", f"{commit}:{path}")
    return {"path": path, "bytes": len(raw), "gitBlob": run(root, "rev-parse", f"{commit}:{path}").decode().strip(),
            "sha256": hashlib.sha256(raw).hexdigest(), "hashBasis": "committed Git blob bytes"}

def tree_pin(root, commit, path):
    raw = run(root, "ls-tree", "-r", "-z", commit, "--", path)
    if not raw:
        raise ValueError(f"Empty input tree: {path}")
    return {"path": path, "gitTree": run(root, "rev-parse", f"{commit}:{path}").decode().strip(),
            "trackedFiles": raw.count(b"\0"), "listingSha256": hashlib.sha256(raw).hexdigest(),
            "hashBasis": "git ls-tree -r -z: modes, Git object IDs, paths; not a compiled artifact hash"}

def table(headers, rows):
    return "\n".join(["| " + " | ".join(headers) + " |",
                      "| " + " | ".join(["---"] * len(headers)) + " |"] +
                     ["| " + " | ".join(str(x).replace("|", "/").replace("\n", " ") for x in row) + " |" for row in rows])

def collect(next_root):
    assert run(ROOT, "rev-parse", "v0.5.8-rc.1^{commit}").decode().strip() == IB_COMMIT
    assert run(next_root, "rev-parse", "HEAD").decode().strip() == NEXT_COMMIT
    pkg = obj(ROOT, IB_COMMIT, "package.json")
    nxt = obj(next_root, NEXT_COMMIT, "dsh-desktop-next/package.json")
    upstream = obj(next_root, NEXT_COMMIT, "dsh-desktop-next/upstream-reference.json")
    assert pkg["version"] == IB_VERSION
    assert nxt["version"] == "2.0.17-next"
    assert nxt["dependencies"]["@deepseek-ai/dsh"] == "0.2.0-rc.2"
    assert nxt["devDependencies"]["electron"] == "44.0.0"
    assert nxt["devDependencies"]["electron-builder"] == "26.15.7"
    assert upstream["commit"] == CORE_COMMIT and upstream["version"] == "0.2.0-rc.2"
    assert run(next_root, "rev-parse", f"{NEXT_COMMIT}:deepseek-harness").decode().strip() == CORE_COMMIT
    env = dict(re.findall(r"^([A-Z0-9_]+)=(.+)$", text(ROOT, IB_COMMIT, "runtime/versions.env"), re.M))
    assert env["IBM_LAB_AGENT_VERSION"] == IB_VERSION
    assert env["DSH_VERSION"] == "0.1.7-rc.1" and env["PYTHON_VERSION"] == "3.12.11"

    ib_files = [
        "package.json", "pnpm-lock.yaml", "package-lock.json", "pnpm-workspace.yaml",
        "harness.lock.json", "runtime/versions.env", "runtime/launcher/package.json",
        "runtime/launcher/pnpm-lock.yaml", "vendor.lock.json", "vendor.manifest.json",
        "python/requirements.lock", "python/requirements-linux.lock",
        "desktop/docs/release-manifest.json", "desktop/src-tauri/tauri.conf.json",
        "desktop/scripts/build-bundled-python.ps1", "desktop/scripts/prepare-runtime.ps1",
        "desktop/scripts/build-windows-release.ps1", "scripts/bundled-python-inputs.mjs",
        "src/python-lock-hash.js", "src/markitdown-patch.js", "scripts/patch-markitdown.mjs",
        "src/dsh-runtime-patch.js", "src/dsh-web-frontend-patch.js",
        "cordis.patch.yml", "presets/lab-research/preset.patch.yml",
        "client/src/descriptors.js",
    ]
    next_files = [
        "package.json", "yarn.lock", ".yarnrc.yml", ".gitmodules", "AGENTS.md",
        "dsh-desktop-next/package.json", "dsh-desktop-next/upstream-reference.json",
        "dsh-desktop-next/cordis.patch.yml", "dsh-desktop-next/host.cordis.patch.yml",
        "dsh-desktop-next/src/extensions.ts", "dsh-desktop-next/src/browser-guests.ts",
        "dsh-desktop-next/src/host-process.ts", "dsh-desktop-next/src/profiles.ts",
        "dsh-desktop-next/src/data-directory.ts", "dsh-desktop-next/src/node-environment.ts",
        "scripts/prepare-dsh-market.mjs", "scripts/prepare-agents-anywhere-release.mjs",
    ]
    lock = {
        "schema": "ibm/electron-next-p0/v1", "frozenOn": "2026-10-02", "phase": "P0",
        "scope": "source inputs only; no installed runtime or binary acceptance",
        "ibm": {"tag": "v" + IB_VERSION, "commit": IB_COMMIT,
                "repository": "git@git.ustc.edu.cn:qbdeng2025/iBM-Lab-Agent.git",
                "files": [file_pin(ROOT, IB_COMMIT, p) for p in ib_files],
                "trees": [tree_pin(ROOT, IB_COMMIT, p) for p in
                          ["lib", "src", "client", "skills", "vendor/nature-skills", "vendor/mnova-mcp"]]},
        "next": {"tag": "v2.0.17-next", "commit": NEXT_COMMIT,
                 "repository": "https://github.com/anywhere-labs/dsh-desktop",
                 "files": [file_pin(next_root, NEXT_COMMIT, p) for p in next_files]},
        "target": {"dsh": "0.2.0-rc.2", "harnessCommit": CORE_COMMIT,
                   "electron": "44.0.0", "electronBuilder": "26.15.7",
                   "yarn": "4.18.0", "python": env["PYTHON_VERSION"],
                   "oldBundledNode": env["NODE_VERSION"],
                   "hostNodeStrategy": "NEXT Electron Node-mode; validate modules/launchers in P1"},
        "resourceVersions": obj(ROOT, IB_COMMIT, "desktop/docs/release-manifest.json"),
        "skills": obj(ROOT, IB_COMMIT, "vendor.lock.json"),
        "buildPolicy": {"floatingRefreshAllowed": False, "userDataReadAllowed": False,
                        "oldRuntimeSnapshotApproved": False,
                        "binaryMaterialization": "not started",
                        "wheelArchiveChecksums": "to freeze after acquisition before P1 runtime acceptance"},
    }

    paths = run(ROOT, "ls-tree", "-r", "--name-only", IB_COMMIT, "--", "lib").decode().splitlines()
    services, domains, tools = [], [], []
    for path in sorted(p for p in paths if p.endswith(".js")):
        source = text(ROOT, IB_COMMIT, path)
        for match in re.finditer(r'super\(ctx,\s*"([^"]+)"\)', source):
            name = match.group(1)
            inject = re.search(r"static inject\s*=\s*\[([^\]]*)\]", source)
            services.append({"name": name, "source": path, "line": source[:match.start()].count("\n") + 1,
                             "requiredInject": re.findall(r'"([^"]+)"', inject.group(1)) if inject else [],
                             "plannedOwner": OWNERS[name]})
        for match in re.finditer(r"defineDomain\(\s*\{(.*?)\}\s*\)", source, re.S):
            body = match.group(1)
            name = re.search(r'name:\s*"([^"]+)"', body)
            if name:
                domains.append({"name": name.group(1), "source": path,
                                "version": int(re.search(r"version:\s*(\d+)", body).group(1)),
                                "tables": re.findall(r"(\w+):\s*domainTable\(", body)})
        if path.endswith("-tool.js"):
            named = list(re.finditer(r'name:\s*"(lab_[^"]+)"', source))
            # tasks-tool declares five browser operations in a reviewed literal tuple loop.
            if path == "lib/tasks-tool.js":
                loop = re.search(r"for \(const \[name, action, description, parameters\] of \[(.*?)\n\t\]\)", source, re.S)
                assert loop, "Browser-operation registration shape changed"
                named += list(re.finditer(r'\["(lab_[^"]+)"', loop.group(1)))
                for match in named[-5:]:
                    tools.append({"name": match.group(1), "source": path, "registration": "reviewed tuple-loop literal"})
                named = named[:-5]
            for match in named:
                tools.append({"name": match.group(1), "source": path,
                              "line": source[:match.start()].count("\n") + 1, "registration": "literal name"})
    assert len(services) == 24 and len({s["name"] for s in services}) == 24
    assert len({t["name"] for t in tools}) == len(tools)
    assert len(next(d["tables"] for d in domains if d["name"] == "lab_tasks")) == 8
    main = text(ROOT, IB_COMMIT, "desktop/src-tauri/src/main.rs")
    commands = re.findall(r"\b[a-z][a-z_]+\b", re.search(r"generate_handler!\[(.*?)\]", main, re.S).group(1))
    # Only this pure module is evaluated; it has no imports, host boot, or data access.
    descriptor_source = text(ROOT, IB_COMMIT, "client/src/descriptors.js")
    assert not re.search(r"^\s*import\b", descriptor_source, re.M)
    js = descriptor_source.replace("export function buildDescriptors", "function buildDescriptors", 1)
    descriptors = json.loads(subprocess.check_output(["node", "--input-type=module", "-e",
                            js + "\nconsole.log(JSON.stringify(buildDescriptors()))"], cwd=ROOT))
    remote_source = text(ROOT, IB_COMMIT, "lib/remote.js")
    remote_methods = {m for m in re.findall(r"^\s*(?:async\s+)?(\w+)\([^)]*\)\s*\{", remote_source, re.M)}
    assert all(d["method"] in remote_methods for d in descriptors)
    assert len({d["id"] for d in descriptors}) == len(descriptors)
    assert "synth_route_lock" not in {d["method"] for d in descriptors}
    assert not any(t["name"] == "lab_synth_route_lock" for t in tools)
    assert next(d for d in descriptors if d["method"] == "note_templates_list")["parameters"][0]["name"] == "request"
    inventory = {"baselineCommit": IB_COMMIT, "method": "static source declarations; Remote descriptors evaluated from pure module",
                 "services": services, "domains": domains, "agentTools": sorted(tools, key=lambda t: t["name"]),
                 "desktopCommands": commands, "remoteDescriptors": descriptors,
                 "clientInject": pkg["dsh"]["client"]["inject"]}

    interface_md = "# P0 接口基线\n\n基线 " + IB_VERSION + "。服务与 Agent 工具来自源码声明；Remote 为纯描述符构造结果，不代表 rc.2 运行验证。\n\n"
    interface_md += table(["服务", "文件", "必需注入", "规划归属"],
                          [(s["name"], s["source"] + ":" + str(s["line"]), ", ".join(s["requiredInject"]), s["plannedOwner"]) for s in services])
    interface_md += "\n\n**Remote 参数基线**\n\n" + table(["旧方法 lab/*", "参数"],
                        [(d["method"], ", ".join(p["name"] for p in d["parameters"]) or "无") for d in descriptors])
    interface_md += "\n\n**Agent 工具名称**\n\n" + table(["名称", "声明文件", "声明形式"],
                        [(t["name"], t["source"], t["registration"]) for t in sorted(tools, key=lambda t: t["name"])])
    interface_md += "\n\n**现有桌面命令**\n\n" + table(["命令", "迁移目标"],
                        [(c, "NEXT native adapter；保留参数/结果/取消行为并在 P1/P4 逐项核对") for c in commands]) + "\n"
    data_md = "# P0 数据与所有权清单\n\n仅记录源码 schema 和路径约定，未读取用户数据、密钥或机构 Cookie。物理 JSON 存放位置需根据实际 profile/backend 配置在 P1 的测试 home 验证。\n\n"
    data_md += table(["domain", "schema version", "表", "声明文件"],
                     [(d["name"], d["version"], ", ".join(d["tables"]), d["source"]) for d in domains])
    data_md += """

**路径与迁移规则**

| 数据 | 0.5.8 约定 | 迁移规则 |
|---|---|---|
| 桌面数据根 | %LOCALAPPDATA%/iBM-Lab-Agent | 识别实际配置；复制备份后导入 |
| DSH home | 数据根/dsh | 新 NEXT home 独立，禁止新旧内核共写 |
| 课题文件 | DSH_HOME/lab-agent/projects/<projectId> | 保留 ID、相对路径、文件 hash 与来源 |
| 自定义模板/版本 | 对应模板 domain 与 lab-agent 目录 | 保留历史快照与全局默认 |
| 核心记忆/会话 | lab_tasks 中版本行与绑定行；DSH 会话存储 | 对账版本链、hash、session/workspace 引用 |
| 密钥 | 数据根/config/api-key.dpapi | 后续在受限本机层兼容读取，不导出到清单 |
| 浏览器登录 | 旧 Tauri WebView 独立会话 | 不承诺 Cookie 跨引擎复用；按需重新登录 |
| MCP/临时目录 | config、runtime-state、workspace/.lab-tmp | 重新探测路径与授权；临时目录不当作永久产物 |

第一轮 core 是 lab_tasks 的唯一打开者。课题/记忆/绑定/provenance 归 core；检索/资料包/报告/PPT 工作流归 literature。
其他 domain 的唯一所有者随对应业务插件迁移。卸载保留数据；数据删除是另一个显式动作。
"""
    resource_md = "# P0 运行时输入锁定\n\n" + table(["资源", "固定值", "输入"],
         [("Python", env["PYTHON_VERSION"], "runtime/versions.env；Windows recipe"),
          ("旧 Node", env["NODE_VERSION"], "旧业务基线，NEXT 优先复用 Electron Node-mode"),
          ("Origin MCP", lock["resourceVersions"]["originMcp"]["version"], lock["resourceVersions"]["originMcp"]["commit"]),
          ("Mnova MCP", lock["resourceVersions"]["mnovaMcp"]["version"], lock["resourceVersions"]["mnovaMcp"]["commit"]),
          ("MCP SDK", lock["resourceVersions"]["mcpSdk"], "python/requirements.lock"),
          ("Nature Skills", lock["skills"]["pinnedCommit"], "vendor.lock.json 与已提交 vendor tree")])
    resource_md += "\n\n**关键源码输入 SHA-256**\n\n" + table(["组件", "输入", "SHA-256（Git 原始 blob）"],
            [("iBM", x["path"], x["sha256"]) for x in lock["ibm"]["files"]] +
            [("NEXT", x["path"], x["sha256"]) for x in lock["next"]["files"]])
    resource_md += "\n\n**源码树指纹**\n\n" + table(["树", "文件数", "Git tree", "清单 SHA-256"],
            [(x["path"], x["trackedFiles"], x["gitTree"], x["listingSha256"]) for x in lock["ibm"]["trees"]])
    resource_md += """

这些是输入指纹，不是安装包、Python.exe、wheel 或运行时目录的制品校验值。不同工作区 CRLF/LF 不影响 Git blob 指纹。
Windows recipe 还固定 MarkItDown 0.1.7 及其格式依赖，并从已提交 Mnova 源码构建 wheel；recipe 与补丁均已入锁。
desktop/release-manifest 的 Python 字段仅为 3.12，精确版本以 runtime/versions.env 的 3.12.11 为准。

**P1 前置事项**

- 已有系统 Node 为 24.19.0，满足 NEXT 开发版本范围；其版本与旧捆绑 Node 24.16.0 分开记录。
- 已安装 Python 3.12 为 3.12.10，默认 python 为 3.11.9；均不作为 3.12.11 合格基底。P1 构建需取得并校验精确版本。
- 当前迁移分支尚未物化 node_modules、Python dist 与新的安装包。旧 Toolchain/windows-runtime-v0.4.2 及 Releases/v0.4.* 未批准复用。
- Python 依赖目前有版本 pin，离线 wheel/archive 内容 SHA-256 须在取得实际制品后冻结；P0 不声称已有离线资源。
- 根 NEXT build/dev/dist 会运行 market:prepare 或 aa:prepare-release。固定标签构建不得静默刷新 latest；
  P1 采用不刷新依赖的 workspace 构建路径，并在运行前审查该路径及固定安装锚点。
- 不改业务依赖到 rc.2、不执行补丁、不安装依赖、不启动图形程序、不运行迁移用户数据，以上属于后续阶段。
"""
    counts = {"services": len(services), "domains": len(domains), "tables": sum(len(d["tables"]) for d in domains),
              "agentTools": len(tools), "remoteMethods": len(descriptors), "desktopCommands": len(commands)}
    return {"baseline.lock.json": pretty(lock), "inventories.json": pretty(inventory),
            "interfaces.md": interface_md, "data-map.md": data_md, "resource-inputs.md": resource_md}, counts

def verify_outputs(expected, directory):
    problems = []
    for name, content in expected.items():
        path = directory / name
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            problems.append(name)
    return problems

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--next-root", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected, counts = collect(args.next_root.resolve())
    if args.check:
        problems = verify_outputs(expected, OUT)
        if problems:
            raise SystemExit("FAIL: baseline changed or missing: " + ", ".join(problems))
        print(pretty({"status": "PASS", "scope": "P0 source pins and declaration inventory", **counts}), end="")
        return
    if any((OUT / name).exists() for name in expected):
        raise SystemExit("Refusing to overwrite frozen baseline; use --check or explicitly review a new baseline.")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, content in expected.items():
        (OUT / name).write_text(content, encoding="utf-8", newline="\n")
    print(pretty({"status": "WRITTEN", **counts}), end="")

if __name__ == "__main__":
    main()
