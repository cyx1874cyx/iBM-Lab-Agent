#!/usr/bin/env python3
"""
iBM Lab 文献捕获 — Native Messaging host 安装/卸载脚本（Windows）。

用法：
  python install-bridge.py <EXTENSION_ID>
  python install-bridge.py <EXTENSION_ID> --uninstall
  python install-bridge.py --list        # 仅显示扩展 id（chrome://extensions 手动查）

<EXTENSION_ID> 是扩展安装后 chrome://extensions 里显示的 32 位字母 id。
脚本会把 com.ibm.lab.capture.json 注册到 Chrome 与 Edge 的
NativeMessagingHosts 注册表位置，并指向本目录的 bridge.cmd。
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import winreg

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "com.ibm.lab.capture.json")
BRIDGE_CMD = os.path.join(HERE, "bridge.cmd")

EXTENSION_ID_RE = "abcdefghijklmnop"  # 校验用；实际按长度与字符集检查

HOST_PATHS = [
    ("Chrome", r"Software\Google\Chrome\NativeMessagingHosts"),
    ("Edge", r"Software\Microsoft\Edge\NativeMessagingHosts"),
]


def validate_extension_id(value):
    if len(value) != 32 or not all(ch in "abcdefghijklmnop" for ch in value.lower()):
        return False
    return True


def install(extension_id):
    if not os.path.exists(BRIDGE_CMD):
        print("错误：找不到 bridge.cmd（请确认在扩展目录的 native-bridge 下运行）")
        return 1
    with open(TEMPLATE, "r", encoding="utf-8") as handle:
        manifest = handle.read()
    manifest = manifest.replace("%%BRIDGE_PATH%%", BRIDGE_CMD.replace("\\", "\\\\"))
    manifest = manifest.replace("%%EXTENSION_ID%%", extension_id.lower())
    for browser, subkey in HOST_PATHS:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, subkey) as key:
            winreg.SetValueEx(key, "com.ibm.lab.capture", 0, winreg.REG_SZ, manifest)
        print(f"[OK] 已注册 {browser} NativeMessagingHosts → com.ibm.lab.capture")
    print("完成。请重新加载扩展（chrome://extensions 中点击刷新）。")
    return 0


def uninstall():
    for browser, subkey in HOST_PATHS:
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, subkey + r"\com.ibm.lab.capture")
            print(f"[OK] 已移除 {browser} 注册")
        except FileNotFoundError:
            print(f"[--] {browser} 未注册，跳过")
    return 0


def show_extension_id():
    print("获取扩展 id：")
    print("  1. 打开 chrome://extensions，开启「开发者模式」；")
    print("  2. 「加载已解压的扩展程序」选择本目录的上一级（ibm-literature-capture）；")
    print("  3. 卡片上显示的 32 位字母串即为扩展 id。")
    return 0


def main():
    parser = argparse.ArgumentParser(description="iBM Lab 捕获本地桥接注册脚本")
    parser.add_argument("extension_id", nargs="?", help="扩展 id（chrome://extensions 查看）")
    parser.add_argument("--uninstall", action="store_true", help="卸载桥接注册")
    parser.add_argument("--list", action="store_true", help="说明如何获取扩展 id")
    args = parser.parse_args()

    if args.list:
        return show_extension_id()
    if args.uninstall:
        return uninstall()
    if not args.extension_id:
        parser.print_help()
        return 1
    if not validate_extension_id(args.extension_id):
        print("扩展 id 格式不对：应为 32 位 a–p 字母（MV3 扩展 id 字符集）。")
        return 1
    return install(args.extension_id.lower())


if __name__ == "__main__":
    sys.exit(main())
