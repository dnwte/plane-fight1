# -*- coding: utf-8 -*-
"""============================================================
 本地开发服务器（仅本机调试用，不要部署到 Netlify）
 作用：用一个进程同时干两件事——
   1. 伺服静态文件（index.html / game.js / style.css / 图片/ 等）
   2. 接管 POST /.netlify/functions/generate-map，本机直接调 DeepSeek
 这样用 python -m http.server 时出现的 404 就没了。
 生产环境仍由 functions/generate-map.js（Netlify Function）处理。

 用法：
   1. 配置 DeepSeek 密钥（二选一）：
      a) 设环境变量 DEEPSEEK_API_KEY=sk-xxxxx
      b) 在本目录建一个文件 DEEPSEEK_API_KEY.txt，里面只写密钥
         （此文件仅本机用，切勿提交 git / 部署）
   2. 运行：python dev_server.py
   3. 浏览器打开 http://127.0.0.1:8000/
============================================================"""

import http.server
import socketserver
import json
import os
import re
import urllib.request
import urllib.error

PORT = 8000
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
MAP_ROWS = 20
MAP_COLS = 26
WEB_DIR = os.path.dirname(os.path.abspath(__file__))


def get_api_key():
    """读 DeepSeek 密钥：先环境变量，再本地文件"""
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if key:
        return key
    key_file = os.path.join(WEB_DIR, "DEEPSEEK_API_KEY.txt")
    if os.path.exists(key_file):
        with open(key_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def build_prompt(desc):
    """构造给 DeepSeek 的提示词（和 functions/generate-map.js 保持一致）"""
    return (
        "你是一个坦克大战地图生成器。请根据用户的描述生成地图。\n\n"
        "地图规格：\n"
        "- 严格 20 行 × 26 列的二维数组\n"
        "- 数字含义：0 = 空地（可通行），1 = 砖墙（可被打碎），2 = 钢墙（不可摧毁的掩体）\n"
        "- 一定要给玩家和敌方坦克留出可通行的空地走廊，禁止把整张图填满墙\n"
        "- 数组里只能有 0/1/2 这三种数字，不能有其它内容\n\n"
        f"用户描述：{desc}\n\n"
        "输出要求（非常重要）：\n"
        '- 只返回一个 JSON 对象，格式为 {"map": [[...]]}\n'
        "- 不要任何解释、不要 markdown 代码块、不要多余文字\n"
        "- map 的值必须是 20 行 × 26 列的二维数字数组"
    )


def extract_array(content):
    """从 AI 返回的文本里提取二维数组（先直接解析，失败再正则抠 JSON）"""
    if not content:
        return None
    text = content.strip()
    parsed = None
    try:
        parsed = json.loads(text)
    except Exception:
        m = re.search(r"(\[[\s\S]*\]|\{[\s\S]*\})", text)
        if not m:
            return None
        try:
            parsed = json.loads(m.group(1))
        except Exception:
            return None
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for k in ("map", "data", "grid", "field", "matrix", "board"):
            if isinstance(parsed.get(k), list):
                return parsed[k]
        for v in parsed.values():
            if isinstance(v, list):
                return v
    return None


def normalize_map(data):
    """把 AI 返回的数组规范化成 20×26，值域 0/1/2"""
    result = []
    for r in range(MAP_ROWS):
        src = data[r] if r < len(data) and isinstance(data[r], list) else []
        row = []
        for c in range(MAP_COLS):
            v = src[c] if c < len(src) else 0
            if not isinstance(v, (int, float)) or v != v:  # 非数字或 NaN → 0
                v = 0
            if v not in (0, 1, 2):
                v = 0
            row.append(int(v))
        result.append(row)
    return result


def call_deepseek(desc):
    """调 DeepSeek 接口生成地图，返回规范化后的 20×26 地图数组"""
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY（设环境变量或建 DEEPSEEK_API_KEY.txt）")

    body = json.dumps({
        "model": "deepseek-chat",
        "response_format": {"type": "json_object"},  # 强制返回合法 JSON
        "temperature": 0.7,
        "max_tokens": 4000,
        "messages": [
            {"role": "system",
             "content": "你是坦克大战地图生成器，只输出 JSON 对象，不输出任何解释或 markdown。"},
            {"role": "user", "content": build_prompt(desc)},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        DEEPSEEK_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:  # 60 秒超时
        data = json.loads(resp.read().decode("utf-8"))

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    arr = extract_array(content)
    if not arr or not isinstance(arr[0], list):
        raise RuntimeError("AI 返回内容无法解析为二维数组")
    return normalize_map(arr)


def build_eval_prompt(d):
    """构造给 DeepSeek 的评价提示词（和 functions/evaluate.js 一致）"""
    won = d.get("result") == "win"
    lines = [
        "你是一个坦克大战游戏的解说员，根据玩家本局表现给一句简短有趣的评价（1-3 句话）。",
        "要求：",
        "- 语气活泼，像游戏解说，带点情绪",
        "- " + ("玩家赢了，给予鼓励和夸奖" if won else "玩家输了，给予安慰和一点小建议"),
        "- 不要超过 3 句话，不要用 markdown，不要用引号包裹",
        '- 只返回 JSON 对象，格式为 {"comment": "..."}',
        "",
        "玩家本局数据：",
        "- 结果：" + ("胜利" if won else "失败"),
        f"- 到达关卡：第 {d.get('level', 1)} 关",
        f"- 最终得分：{d.get('score', 0)}",
        f"- 剩余生命：{d.get('lives', 0)}",
        f"- 基地剩余血量：{d.get('baseHp', 0)}",
    ]
    if not won:
        lines.append("- 失败原因：" + str(d.get("reason") or "被击败"))
    return "\n".join(lines)


def call_deepseek_eval(d):
    """调 DeepSeek 接口生成评价，返回 {"comment": "..."}"""
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    body = json.dumps({
        "model": "deepseek-chat",
        "response_format": {"type": "json_object"},
        "temperature": 0.9,       # 评价更有变化
        "max_tokens": 300,        # 评价很短
        "messages": [
            {"role": "system",
             "content": "你是坦克大战游戏解说员，只输出 JSON 对象，不输出任何解释或 markdown。"},
            {"role": "user", "content": build_eval_prompt(d)},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        DEEPSEEK_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    content = (data.get("choices", [{}])[0].get("message", {}).get("content", "") or "").strip()
    try:
        parsed = json.loads(content)
    except Exception:
        # 解析失败：原文兜底
        return {"comment": content[:200] or "本局表现不错，继续加油！"}
    comment = parsed.get("comment") or parsed.get("text") or parsed.get("message") or "本局表现不错，继续加油！"
    return {"comment": comment}


class Handler(http.server.SimpleHTTPRequestHandler):
    """GET 伺服静态文件；POST 接管 AI 生成地图接口"""

    def __init__(self, *args, **kwargs):
        # directory 参数让 SimpleHTTPRequestHandler 从项目目录伺服文件（Python 3.7+）
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_POST(self):
        # 兼容前端调用的路径：地图生成 + 关卡评价
        if self.path in ("/.netlify/functions/generate-map", "/generate-map"):
            self.handle_generate_map()
        elif self.path in ("/.netlify/functions/evaluate", "/evaluate"):
            self.handle_evaluate()
        else:
            self.send_error(404)

    def _send_json(self, code, obj):
        """统一返回 JSON（成功/失败都用，前端总能 res.json()）"""
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_generate_map(self):
        # 1. 解析请求体
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._send_json(400, {"error": "请求体不是合法 JSON"})
            return

        # 2. 兼容 prompt / description
        desc = (body.get("prompt") or body.get("description") or "").strip()
        if not desc:
            self._send_json(400, {"error": "缺少 prompt 字段（地图描述）"})
            return

        # 3. 调 DeepSeek
        try:
            map_arr = call_deepseek(desc)
        except urllib.error.HTTPError as e:
            # DeepSeek 返回非 2xx
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:500]
            except Exception:
                pass
            self._send_json(502, {"error": f"DeepSeek 接口返回错误（HTTP {e.code}）", "detail": detail})
            return
        except urllib.error.URLError as e:
            # 网络层错误（DNS/超时/断网）
            self._send_json(502, {"error": f"调用 DeepSeek 失败：{e.reason}"})
            return
        except Exception as e:
            self._send_json(502, {"error": f"生成失败：{e}"})
            return

        # 4. 返回地图数组
        self._send_json(200, map_arr)

    def handle_evaluate(self):
        """处理评价请求：解析 body → 调 DeepSeek → 返回 {comment}"""
        # 1. 解析请求体
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._send_json(400, {"error": "请求体不是合法 JSON"})
            return

        # 2. 调 DeepSeek 生成评价
        try:
            result = call_deepseek_eval(body)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:500]
            except Exception:
                pass
            self._send_json(502, {"error": f"DeepSeek 接口返回错误（HTTP {e.code}）", "detail": detail})
            return
        except urllib.error.URLError as e:
            self._send_json(502, {"error": f"调用 DeepSeek 失败：{e.reason}"})
            return
        except Exception as e:
            self._send_json(502, {"error": f"生成评价失败：{e}"})
            return

        # 3. 返回评价
        self._send_json(200, result)

    def log_message(self, format, *args):
        # 简化日志输出
        super().log_message(format, *args)


class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True  # 端口被占用时能重用，方便重启


if __name__ == "__main__":
    key = get_api_key()
    print("=" * 50)
    print(f" 本地开发服务器  端口 {PORT}")
    print(f" DEEPSEEK_API_KEY: {'已配置' if key else '未配置（AI 生成会失败）'}")
    print(f" 工作目录: {WEB_DIR}")
    print(f" 打开浏览器: http://127.0.0.1:{PORT}/")
    print("=" * 50)
    if not key:
        print(" 提示：请在环境变量设置 DEEPSEEK_API_KEY，")
        print("       或在本目录创建 DEEPSEEK_API_KEY.txt 文件写入密钥。")
    with ReuseTCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")
