@echo off
rem iBM Lab 文献捕获 — Native Messaging host 包装器（manifest 的 path 指向本文件）。
rem 桥接程序本体是 host.py；用 cmd 包装是为了让 Chrome 无需知道 Python 解释器路径。
python "%~dp0host.py"
