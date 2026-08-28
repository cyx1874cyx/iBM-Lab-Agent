#!/usr/bin/env python3
"""
iBM Lab 文献捕获 — Native Messaging host 安装/卸载脚本（Windows）。

用法：
  python install-bridge.py <EXTENSION_ID>
  python install-bridge.py <EXTENSION_ID> --uninstall
  python install-bridge.py --list        # 仅显示扩展 id（chrome://extensions 手动查）

<EXTENSION_ID> 是扩展安装后 chrome://extensions 里显示的 32 位字母 id。
脚本会生成绑定当前 Python 解释器的 bridge.generated.cmd 与 host manifest，
再把 manifest 文件路径注册到 Chrome 与 Edge 的 NativeMessagingHosts。
"""

import argparse
import json
import os
import sys
import winreg

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "com.ibm.lab.capture.json")
GENERATED_BRIDGE_CMD = os.path.join(HERE, "bridge.generated.cmd")
INSTALLED_MANIFEST = os.path.join(HERE, "com.ibm.lab.capture.generated.json")

EXTENSION_ID_RE = "abcdefghijklmnop"  # 校验用；实际按长度与字符集检查

HOST_PATHS = [
    ("Chrome", r"Software\Google\Chrome\NativeMessagingHosts"),
    ("Edge", r"Software\Microsoft\Edge\NativeMessagingHosts"),
]
REGISTRY_VIEWS = [
    ("32位", winreg.KEY_WOW64_32KEY),
    ("64位", winreg.KEY_WOW64_64KEY),
]


def validate_extension_id(value):
    if len(value) != 32 or not all(ch in "abcdefghijklmnop" for ch in value.lower()):
        return False
    return True


def install(extension_id):
    host_py = os.path.join(HERE, "host.py")
    if not os.path.exists(host_py):
        print("错误：找不到 host.py（请确认在扩展目录的 native-bridge 下运行）")
        return 1
    # 固定使用执行安装脚本的同一个 Python，避免 Chrome 启动时 PATH 不同或命中
    # Microsoft Store 的 python 别名。保留 bridge.cmd 仅作手工排查回退。
    with open(GENERATED_BRIDGE_CMD, "w", encoding="utf-8", newline="\r\n") as handle:
        handle.write("@echo off\n")
        handle.write(f'"{os.path.abspath(sys.executable)}" "{os.path.abspath(host_py)}"\n')
        handle.write("exit /b %errorlevel%\n")
    with open(TEMPLATE, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    manifest["path"] = os.path.abspath(GENERATED_BRIDGE_CMD)
    manifest["allowed_origins"] = [f"chrome-extension://{extension_id.lower()}/"]
    with open(INSTALLED_MANIFEST, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    manifest_path = os.path.abspath(INSTALLED_MANIFEST)
    for browser, subkey in HOST_PATHS:
        host_key = subkey + r"\com.ibm.lab.capture"
        for view, flag in REGISTRY_VIEWS:
            access = winreg.KEY_WRITE | flag
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, host_key, 0, access) as key:
                # Chrome 要求默认值为 host manifest 文件的绝对路径，不是 JSON 内容。
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_path)
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, subkey, 0, access) as parent:
                    winreg.DeleteValue(parent, "com.ibm.lab.capture")
            except FileNotFoundError:
                pass
            print(f"[OK] 已注册 {browser}({view}) NativeMessagingHosts → {manifest_path}")
    print("完成。请重新加载扩展（chrome://extensions 中点击刷新）。")
    print("提示：扩展每次「重新打包/重装」后 id 可能变化，若扩展报"
          "「Specified native messaging host not found」，用新 id 重跑本脚本，"
          "再执行 --verify 校验。")
    return 0


def uninstall():
    for browser, subkey in HOST_PATHS:
        for view, flag in REGISTRY_VIEWS:
            try:
                winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, subkey + r"\com.ibm.lab.capture", flag, 0)
                print(f"[OK] 已移除 {browser}({view}) 注册")
            except FileNotFoundError:
                print(f"[--] {browser}({view}) 未注册，跳过")
    for generated in (INSTALLED_MANIFEST, GENERATED_BRIDGE_CMD):
        try:
            os.remove(generated)
        except FileNotFoundError:
            pass
    return 0


def show_extension_id():
    print("获取扩展 id：")
    print("  1. 打开 chrome://extensions，开启「开发者模式」；")
    print("  2. 「加载已解压的扩展程序」选择本目录的上一级（ibm-literature-capture）；")
    print("  3. 卡片上显示的 32 位字母串即为扩展 id。")
    return 0


def verify(extension_id=None):
    """校验注册状态：host 是否注册、path 是否可执行、allowed_origins 是否匹配当前扩展。"""
    ok = True
    for browser, subkey in HOST_PATHS:
        for view, flag in REGISTRY_VIEWS:
            key = subkey + r"\com.ibm.lab.capture"
            try:
                access = winreg.KEY_READ | flag
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, access) as handle:
                    manifest_path, _ = winreg.QueryValueEx(handle, "")
            except FileNotFoundError:
                print(f"[FAIL] {browser}({view})：未注册（先运行 install-bridge.py <扩展id>）")
                ok = False
                continue
            print(f"[INFO] {browser}({view})：manifest={manifest_path}")
            if not os.path.isabs(manifest_path) or not os.path.isfile(manifest_path):
                print(f"[FAIL] {browser}({view})：注册表必须指向存在的 manifest JSON 绝对路径")
                ok = False
                continue
            try:
                with open(manifest_path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, ValueError) as error:
                print(f"[FAIL] {browser}({view})：无法读取 manifest JSON：{error}")
                ok = False
                continue
            path = data.get("path", "")
            allowed = data.get("allowed_origins", [])
            print(f"[INFO] {browser}({view})：path={path}")
            print(f"[INFO] {browser}({view})：allowed_origins={allowed}")
            if not os.path.exists(path):
                print(f"[FAIL] {browser}({view})：path 指向的文件不存在（{path}）——请确认目录未移动")
                ok = False
            if extension_id and f"chrome-extension://{extension_id}/" not in allowed:
                print(f"[FAIL] {browser}({view})：allowed_origins 与当前扩展 id 不匹配（期望 {extension_id}）——重新打包后 id 会变化，请重跑 install-bridge.py {extension_id}")
                ok = False
    print("校验" + ("通过" if ok else "未通过，请按上方提示修复"))
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(description="iBM Lab 捕获本地桥接注册脚本")
    parser.add_argument("extension_id", nargs="?", help="扩展 id（chrome://extensions 查看）")
    parser.add_argument("--uninstall", action="store_true", help="卸载桥接注册")
    parser.add_argument("--list", action="store_true", help="说明如何获取扩展 id")
    parser.add_argument("--verify", action="store_true", help="校验注册状态（可带扩展 id 一并比对）")
    args = parser.parse_args()

    if args.list:
        return show_extension_id()
    if args.uninstall:
        return uninstall()
    if args.verify:
        if args.extension_id and not validate_extension_id(args.extension_id):
            print("扩展 id 格式不对：应为 32 位 a–p 字母（MV3 扩展 id 字符集）。")
            return 1
        return verify(args.extension_id.lower() if args.extension_id else None)
    if not args.extension_id:
        parser.print_help()
        return 1
    if not validate_extension_id(args.extension_id):
        print("扩展 id 格式不对：应为 32 位 a–p 字母（MV3 扩展 id 字符集）。")
        return 1
    return install(args.extension_id.lower())


if __name__ == "__main__":
    sys.exit(main())
