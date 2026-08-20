"""
USTC LLM API 反向代理（校内虚拟机 / 跳板机上运行）

透明透传所有路径到 https://api.llm.ustc.edu.cn，
只做两件事：
  1. 把请求里的认证信息替换为服务端 Token；
  2. 按请求中的 model 把流量路由到指定 Token（默认 flash→key1，pro→key2，
     其余模型回退到多 Token 轮询分摊 RPM）。

因此 OpenAI 协议 (/v1/chat/completions)、Anthropic 协议 (/v1/messages)、
流式 (SSE) 与非流式请求都能直接通过。

安全设计：
  * 默认只监听 127.0.0.1 —— 校内任何人都无法借用你的 Token 额度；
    校外只能通过 SSH 隧道 (-L 4000:localhost:4000) 访问。
  * Token 从环境变量读取，不写死在脚本里。

运行（多个 key 用空格分隔）：
    ./vm-setup.sh sk-xxx1 sk-xxx2
  或
    USTC_API_KEY=sk-xxx1 USTC_EXTRA_KEYS=sk-xxx2 python proxy-server.py

依赖：
    pip install fastapi uvicorn httpx

环境变量：
    USTC_API_KEY            主 Token（必需）—— 作为路由表中的 key0（flash 默认用）
    USTC_EXTRA_KEYS         额外 Token，逗号分隔（可选）—— 第一个作为 key1（pro 默认用）
    MODEL_ROUTE_FLASH       含 "flash" 的模型用哪个下标 Token（默认 0）
    MODEL_ROUTE_PRO         含 "pro"   的模型用哪个下标 Token（默认 1）
    USTC_UPSTREAM_BASE      上游地址，默认 https://api.llm.ustc.edu.cn
    USTC_LISTEN_HOST        监听地址，默认 127.0.0.1
    USTC_LISTEN_PORT        监听端口，默认 4000
    USTC_TIMEOUT            单请求超时秒数，默认 600
"""

import itertools
import json
import os
import sys

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

UPSTREAM_BASE = os.environ.get("USTC_UPSTREAM_BASE", "https://api.llm.ustc.edu.cn")
LISTEN_HOST = os.environ.get("USTC_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("USTC_LISTEN_PORT", "4000"))
REQUEST_TIMEOUT = float(os.environ.get("USTC_TIMEOUT", "600"))

# 收集所有 key：主 key + 额外 key（兼容逗号/空格分隔，去重保序）
_raw_keys = (os.environ.get("USTC_API_KEY", "") + "," + os.environ.get("USTC_EXTRA_KEYS", "")) \
    .replace(" ", ",").split(",")
API_KEYS = list(dict.fromkeys(k.strip() for k in _raw_keys if k.strip()))

if not API_KEYS:
    sys.exit(
        "错误：未设置 API key。\n"
        "从 llm.ustc.edu.cn 申请 Token（sk-xxx 格式）后：\n"
        "  方式一（推荐）: ./vm-setup.sh sk-xxx1 [sk-xxx2 ...]\n"
        "  方式二: export USTC_API_KEY=sk-xxx1\n"
        "          export USTC_EXTRA_KEYS=sk-xxx2,sk-xxx3   (可选)\n"
        "          python proxy-server.py"
    )

# 按 model 名路由到指定 Token 的下标（只影响路由命中模型；未命中走轮询）
MODEL_ROUTE_FLASH = int(os.environ.get("MODEL_ROUTE_FLASH", "0"))  # 含 "flash" 的模型 → Token[0] = key1(USTC_API_KEY)
MODEL_ROUTE_PRO = int(os.environ.get("MODEL_ROUTE_PRO", "1"))      # 含 "pro" 的模型 → Token[1] = key2(USTC_EXTRA_KEYS 第一个)

# 多 key 轮询迭代器（未命中 model 路由的请求之间轮流切换 key，分摊 RPM）
_key_pool = itertools.cycle(API_KEYS)


def _route_key_index(model: str):
    """根据请求中的 model 返回应使用的 API_KEYS 下标；未命中返回 None。"""
    if not model:
        return None
    m = model.lower()
    if "flash" in m:
        return MODEL_ROUTE_FLASH
    if "pro" in m:
        return MODEL_ROUTE_PRO
    return None


def select_key(model: str) -> str:
    """先按 model 路由，越界（池子不够大）则回退到轮询/首 key。"""
    idx = _route_key_index(model)
    if idx is not None and 0 <= idx < len(API_KEYS):
        return API_KEYS[idx]
    return next(_key_pool)


# 客户端发来的这些头一律不转发（认证一律以我们的 Token 为准）
SKIP_INCOMING_HEADERS = {
    "host",
    "content-length",
    "x-api-key",
    "authorization",
    "proxy-authorization",
    "connection",
}

app = FastAPI(title="USTC LLM Proxy")
client = httpx.AsyncClient(timeout=httpx.Timeout(REQUEST_TIMEOUT))


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def proxy(request: Request, path: str):
    """通用反向代理：原样透传请求，仅替换认证头（按 model 路由/轮询）。"""
    target_url = f"{UPSTREAM_BASE.rstrip('/')}/{path}"
    body = await request.body()

    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in SKIP_INCOMING_HEADERS
    }

    # 从请求体解析 model（OpenAI / Anthropic 协议都在 JSON body 里），用于路由 key
    model = None
    is_stream = False
    if body:
        try:
            payload = json.loads(body)
            model = payload.get("model")
            is_stream = bool(payload.get("stream", False))
        except Exception:
            pass

    headers["Authorization"] = f"Bearer {select_key(model)}"

    if is_stream:
        req = client.build_request(request.method, target_url, headers=headers, content=body)
        resp = await client.send(req, stream=True)
        return StreamingResponse(
            resp.aiter_bytes(),
            status_code=resp.status_code,
            headers=_filter_headers(dict(resp.headers)),
            media_type="text/event-stream",
        )

    resp = await client.request(request.method, target_url, headers=headers, content=body)
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=_filter_headers(dict(resp.headers)),
        media_type=resp.headers.get("content-type", "application/json"),
    )


def _filter_headers(headers: dict) -> dict:
    """过滤掉不适合转发的响应头。"""
    skip = {"transfer-encoding", "content-encoding", "connection", "keep-alive", "content-length"}
    return {k: v for k, v in headers.items() if k.lower() not in skip}


if __name__ == "__main__":
    import uvicorn

    routes = {
        "flash": MODEL_ROUTE_FLASH,
        "pro": MODEL_ROUTE_PRO,
    }
    routing_desc = ", ".join(
        f"{kind}->Token[{idx}]"
        for kind, idx in routes.items()
        if 0 <= idx < len(API_KEYS)
    )
    print(
        f"USTC LLM Proxy 已启动: http://localhost:{LISTEN_PORT} -> {UPSTREAM_BASE}\n"
        f"已加载 {len(API_KEYS)} 个 Token: {', '.join(k[:7] + '...' for k in API_KEYS)}\n"
        f"model 路由: {routing_desc or '(无,全部轮询)'}; 未命中模型回退轮询"
    )
    uvicorn.run(app, host=LISTEN_HOST, port=LISTEN_PORT, log_level="info")
