"""Reach the Lumen brain on the AMD box through Jupyter, for when the box can't open a tunnel.

The AMD box sits behind a proxy that blocks cloudflared, ngrok and every other tunnel, but your
browser already talks to it fine through Jupyter. This script uses that same Jupyter connection:

    phones --https--> cloudflared on your Mac --> this script (localhost:5173)
           --Jupyter websocket--> a small relay inside a Python kernel on the box --> Lumen on the box

So the AMD GPU still runs every model; your Mac only passes bytes along.

On your Mac (one time):  python3 -m pip install aiohttp truststore
Run it:                  python3 scripts/jupyter_bridge.py JUPYTER_URL TOKEN
Then in a second tab:    cloudflared tunnel --url http://localhost:5173

JUPYTER_URL is the address of your Jupyter page up to (not including) /lab.
TOKEN is the token from `jupyter server list` on the box.
"""
import argparse
import asyncio
import base64
import json
import re
import sys
import uuid
from datetime import datetime, timezone

import ssl

try:
    import truststore  # trust the same certificates Safari does (python.org's Python ships with none)

    SSL_CONTEXT = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

import aiohttp
from aiohttp import web
from multidict import CIMultiDict

# Runs inside a Python kernel on the box. Turns messages from this script into requests to Lumen there.
KERNEL_CODE = r'''
import asyncio, base64, os, httpx, websockets
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_k, None)  # Lumen is on this machine; don't send it through the box's web proxy
try:
    from comm import get_comm_manager
    _cm = get_comm_manager()
except Exception:
    _cm = get_ipython().kernel.comm_manager
_loop = asyncio.get_event_loop()
_target = "localhost:%PORT%"

def _lumen_open(comm, open_msg):
    client = httpx.AsyncClient(base_url="http://" + _target, timeout=60, trust_env=False)
    queues = {}

    def send(d):
        comm.send(data=d)

    async def http(d):
        try:
            r = await client.request(d["method"], d["path"], headers=d["headers"], content=base64.b64decode(d["body"]))
            send({"t": "resp", "id": d["id"], "status": r.status_code, "headers": list(r.headers.multi_items()),
                  "body": base64.b64encode(r.content).decode()})
        except Exception as e:
            send({"t": "resp", "id": d["id"], "status": 502, "headers": [], "body": base64.b64encode(repr(e).encode()).decode()})

    async def ws_pipe(d):
        q = queues[d["id"]]
        try:
            async with websockets.connect("ws://" + _target + d["path"], subprotocols=d.get("protocols") or None,
                                          max_size=None) as ws:
                async def writer():
                    while True:
                        m = await q.get()
                        if m is None:
                            await ws.close()
                            return
                        await ws.send(m)
                w = asyncio.ensure_future(writer())
                try:
                    async for m in ws:
                        if isinstance(m, bytes):
                            send({"t": "wsmsg", "id": d["id"], "b": base64.b64encode(m).decode()})
                        else:
                            send({"t": "wsmsg", "id": d["id"], "s": m})
                finally:
                    w.cancel()
        except Exception as e:
            print("ws", d["path"], repr(e))
        finally:
            queues.pop(d["id"], None)
            send({"t": "wsclose", "id": d["id"]})

    def handle(d):
        t = d["t"]
        if t == "http":
            asyncio.ensure_future(http(d))
        elif t == "wsopen":
            queues[d["id"]] = asyncio.Queue()
            asyncio.ensure_future(ws_pipe(d))
        elif t in ("wsmsg", "wsclose") and d["id"] in queues:
            queues[d["id"]].put_nowait(None if t == "wsclose" else base64.b64decode(d["b"]) if "b" in d else d["s"])

    comm.on_msg(lambda msg: _loop.call_soon_threadsafe(handle, msg["content"]["data"]))

_cm.register_target("lumen", _lumen_open)
print("lumen relay ready")
'''

HOP = {"host", "connection", "upgrade", "keep-alive", "transfer-encoding", "content-length", "accept-encoding",
       "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"}


class Bridge:
    def __init__(self, url, token, cookie, port):
        self.base = url.rstrip("/")
        self.origin = "/".join(self.base.split("/")[:3])  # e.g. https://jupyter.anruicloud.com, as Safari sends
        if self.base.endswith("/lab"):
            self.base = self.base[:-4]
        headers = {}
        if token:
            headers["Authorization"] = f"token {token}"
        if cookie.lstrip().startswith("curl "):
            # A request copied from Safari's Web Inspector ("Copy as cURL"): reuse the browser's login.
            for name, value in re.findall(r"-H '([^:']+): ([^']*)'", cookie):
                if name.lower() not in HOP | {"content-type", "accept"}:
                    headers[name] = value
            b = re.search(r"(?:-b|--cookie) '([^']*)'", cookie)
            cookie = headers.pop("Cookie", None) or headers.pop("cookie", None) or (b.group(1) if b else "")
            print("Using the browser login from Safari" if cookie else "No cookie found in what you copied.")
        if cookie:
            headers["Cookie"] = cookie
            xsrf = dict(p.strip().split("=", 1) for p in cookie.split(";") if "=" in p).get("_xsrf")
            if xsrf:
                headers["X-XSRFToken"] = xsrf
        self.headers = headers
        self.port = port
        self.session_id = uuid.uuid4().hex
        self.comm_id = uuid.uuid4().hex
        self.pending: dict[str, asyncio.Future] = {}
        self.sockets: dict[str, web.WebSocketResponse] = {}
        self.ready = asyncio.Event()
        self.lock = asyncio.Lock()

    def msg(self, msg_type, content, channel="shell"):
        return {"header": {"msg_id": uuid.uuid4().hex, "username": "lumen", "session": self.session_id,
                           "msg_type": msg_type, "version": "5.3", "date": datetime.now(timezone.utc).isoformat()},
                "parent_header": {}, "metadata": {}, "content": content, "channel": channel, "buffers": []}

    async def send(self, msg):
        async with self.lock:
            await self.kernel.send_str(json.dumps(msg))

    async def to_box(self, data):
        await self.send(self.msg("comm_msg", {"comm_id": self.comm_id, "data": data}))

    async def connect(self):
        self.http = aiohttp.ClientSession(headers=self.headers, connector=aiohttp.TCPConnector(ssl=SSL_CONTEXT))
        # AMD's front door refuses to start kernels from outside the browser, but lets us list and join them,
        # so reuse a kernel that's already running (open any notebook in JupyterLab to start one).
        r = await self.http.get(f"{self.base}/api/kernels")
        if r.status >= 300:
            sys.exit(f"Jupyter said {r.status}: {(await r.text())[:300]}\nCheck the Jupyter address, token and --cookie.")
        kernels = [k for k in await r.json() if k.get("name", "").startswith("python")]
        if kernels:
            kernel_id = kernels[0]["id"]
            print("Joining the kernel already running on the box:", kernel_id)
        else:
            r = await self.http.post(f"{self.base}/api/kernels", json={"name": "python3"})
            if r.status >= 300:
                sys.exit(f"Jupyter said {r.status} when starting a kernel.\n"
                         "In JupyterLab, click File > New > Notebook (Python 3), leave that tab open, and run this again.")
            kernel_id = (await r.json())["id"]
            print("Started a kernel on the box:", kernel_id)
        ws_url = self.base.replace("https://", "wss://").replace("http://", "ws://")
        self.kernel = await self.http.ws_connect(f"{ws_url}/api/kernels/{kernel_id}/channels?session_id={self.session_id}",
                                                 max_msg_size=0, heartbeat=20, origin=self.origin)
        asyncio.ensure_future(self.read())
        await self.send(self.msg("execute_request", {"code": KERNEL_CODE.replace("%PORT%", str(self.port)), "silent": False,
                                                     "store_history": False, "user_expressions": {},
                                                     "allow_stdin": False, "stop_on_error": True}))
        await asyncio.wait_for(self.ready.wait(), 60)
        await self.send(self.msg("comm_open", {"comm_id": self.comm_id, "target_name": "lumen", "data": {}}))
        print(f"Connected. Lumen on the box (port {self.port}) is now at http://localhost:5173 on this Mac.")

    async def read(self):
        async for m in self.kernel:
            if m.type != aiohttp.WSMsgType.TEXT:
                continue
            j = json.loads(m.data)
            kind, content = j.get("msg_type") or j["header"]["msg_type"], j.get("content", {})
            if kind == "stream":
                print("box:", content.get("text", "").rstrip())
                if "lumen relay ready" in content.get("text", ""):
                    self.ready.set()
            elif kind == "error":
                print("box error:", content.get("ename"), content.get("evalue"))
            elif kind == "comm_msg" and content.get("comm_id") == self.comm_id:
                self.from_box(content["data"])
        print("Lost the Jupyter connection. Restart this script.")
        sys.exit(1)

    def from_box(self, d):
        if d["t"] == "resp":
            fut = self.pending.pop(d["id"], None)
            if fut and not fut.done():
                fut.set_result(d)
        elif d["t"] == "wsmsg" and d["id"] in self.sockets:
            ws = self.sockets[d["id"]]
            asyncio.ensure_future(ws.send_bytes(base64.b64decode(d["b"])) if "b" in d else ws.send_str(d["s"]))
        elif d["t"] == "wsclose" and d["id"] in self.sockets:
            asyncio.ensure_future(self.sockets.pop(d["id"]).close())

    async def handle(self, req: web.Request):
        if req.headers.get("Upgrade", "").lower() == "websocket":
            return await self.handle_ws(req)
        rid = uuid.uuid4().hex
        self.pending[rid] = asyncio.get_running_loop().create_future()
        headers = [[k, v] for k, v in req.headers.items() if k.lower() not in HOP]
        await self.to_box({"t": "http", "id": rid, "method": req.method, "path": req.path_qs, "headers": headers,
                           "body": base64.b64encode(await req.read()).decode()})
        try:
            d = await asyncio.wait_for(self.pending[rid], 90)
        except asyncio.TimeoutError:
            self.pending.pop(rid, None)
            return web.Response(status=504, text="The AMD box didn't answer in time.")
        out = CIMultiDict((k, v) for k, v in d["headers"] if k.lower() not in HOP | {"content-encoding"})
        return web.Response(status=d["status"], body=base64.b64decode(d["body"]), headers=out)

    async def handle_ws(self, req: web.Request):
        protocols = [p.strip() for p in req.headers.get("Sec-WebSocket-Protocol", "").split(",") if p.strip()]
        ws = web.WebSocketResponse(protocols=protocols, max_msg_size=0)
        await ws.prepare(req)
        sid = uuid.uuid4().hex
        self.sockets[sid] = ws
        await self.to_box({"t": "wsopen", "id": sid, "path": req.path_qs, "protocols": protocols})
        async for m in ws:
            if m.type == aiohttp.WSMsgType.TEXT:
                await self.to_box({"t": "wsmsg", "id": sid, "s": m.data})
            elif m.type == aiohttp.WSMsgType.BINARY:
                await self.to_box({"t": "wsmsg", "id": sid, "b": base64.b64encode(m.data).decode()})
        if self.sockets.pop(sid, None):
            await self.to_box({"t": "wsclose", "id": sid})
        return ws


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("url", help="Jupyter address, e.g. https://jupyter.anruicloud.com/instances/<id>")
    p.add_argument("token", nargs="?", default="", help="Jupyter token from `jupyter server list` on the box")
    p.add_argument("--cookie", default="", help='browser login, if the token alone is refused: a Cookie header, or a whole "Copy as cURL" from Safari'
)
    p.add_argument("--box-port", type=int, default=5173, help="Lumen's web port on the box (default 5173)")
    p.add_argument("--listen", type=int, default=5173, help="port on this Mac (default 5173)")
    a = p.parse_args()
    bridge = Bridge(a.url, a.token, a.cookie, a.box_port)
    await bridge.connect()
    app = web.Application(client_max_size=50 * 1024 * 1024)
    app.router.add_route("*", "/{tail:.*}", bridge.handle)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", a.listen).start()
    print(f"Now run:  cloudflared tunnel --url http://localhost:{a.listen}")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
