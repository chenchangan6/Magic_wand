from __future__ import annotations

import json
import os
import traceback
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "magic_wand_config.json"
LOCAL_STATE_FILE = ROOT / "magic_wand_local_state.json"
ROOM_RECORD_FILE = ROOT / "magic_wand_game_sessions.jsonl"
LOG_FILE = ROOT / "serve_debug.log"
HOST = "127.0.0.1"
PORT = int(os.environ.get("MAGIC_LAN_PORT", "8777"))
CONTROLLER_BASE = os.environ.get("MAGIC_CONTROLLER_URL", "http://192.168.4.1").rstrip("/")
PROXY_BASE = f"http://{HOST}:{PORT}/api/controller"
DIRECT_OPENER = build_opener(ProxyHandler({}))

LOCAL_STATE_VERSION = 1


def log_line(level: str, message: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    text = f"[{ts}] [{level}] {message}\n"
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        pass


def log_exception(prefix: str, exc: Exception):
    log_line("ERROR", f"{prefix}: {exc}")
    tb = traceback.format_exc()
    if tb:
        for line in tb.rstrip().splitlines():
            log_line("ERROR", line)


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load_json_file(path: Path, default: object):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log_exception(f"load json file failed: {path}", exc)
        return default


def _write_json_file(path: Path, payload: object):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _default_local_state():
    return {
        "schema": LOCAL_STATE_VERSION,
        "updated_at": _now_iso(),
        "device_drafts": {},
        "templates": [],
        "current_room": None,
        "room_history": [],
        "ui": {
            "active_tab": "设备",
            "show_unassigned": True,
        },
    }


def _load_local_state():
    state = _load_json_file(LOCAL_STATE_FILE, _default_local_state())
    if not isinstance(state, dict):
        state = _default_local_state()
    state.setdefault("schema", LOCAL_STATE_VERSION)
    state.setdefault("updated_at", _now_iso())
    state.setdefault("device_drafts", {})
    state.setdefault("templates", [])
    state.setdefault("current_room", None)
    state.setdefault("room_history", [])
    state.setdefault("ui", {"active_tab": "设备", "show_unassigned": True})
    return state


def _save_local_state(payload: object):
    if not isinstance(payload, dict):
        raise ValueError("local state must be an object")
    payload = dict(payload)
    payload["schema"] = LOCAL_STATE_VERSION
    payload["updated_at"] = _now_iso()
    _write_json_file(LOCAL_STATE_FILE, payload)
    return payload


def _append_room_record(payload: object):
    if not isinstance(payload, dict):
        raise ValueError("room record must be an object")
    record = dict(payload)
    record.setdefault("schema", LOCAL_STATE_VERSION)
    record.setdefault("updated_at", _now_iso())
    record_line = json.dumps(record, ensure_ascii=False)
    with ROOM_RECORD_FILE.open("a", encoding="utf-8") as f:
        f.write(record_line + "\n")
    return record


def _load_room_records(tail: int = 100):
    if not ROOM_RECORD_FILE.exists():
        return []
    try:
        with ROOM_RECORD_FILE.open("r", encoding="utf-8", errors="replace") as f:
            lines = [line.strip() for line in f if line.strip()]
    except Exception as exc:
        log_exception("load room records failed", exc)
        return []
    if tail > 0:
        lines = lines[-tail:]
    records = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except Exception as exc:
            log_exception("parse room record failed", exc)
    return records



class ConfigHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, payload: object, status: int = 200):
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        log_line("DEBUG", f"JSON response status={status} path={self.path} bytes={len(data)}")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, data: bytes, content_type: str = "application/octet-stream", status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_index_html(self):
        index_path = ROOT / "index_ui_rebuild.html"
        try:
            html = index_path.read_text(encoding="utf-8")
        except Exception as exc:
            log_exception("read index_ui_rebuild.html failed", exc)
            self._send_json({"error": "index_unavailable", "detail": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        log_line("INFO", f"serve index_ui_rebuild.html bytes={len(html.encode('utf-8'))}")
        self._send_bytes(html.encode("utf-8"), content_type="text/html; charset=utf-8")

    def _load_saved_config(self):
        if not CONFIG_FILE.exists():
            log_line("WARN", "load local config requested but file not found")
            return None, {"error": "no_saved_config"}, HTTPStatus.NOT_FOUND
        try:
            payload = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            log_exception("load local config parse failed", exc)
            return None, {"error": "invalid_saved_config", "detail": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR
        log_line("INFO", f"load local config ok bytes={CONFIG_FILE.stat().st_size}")
        return payload, None, HTTPStatus.OK

    def _proxy_controller(self):
        path = urlparse(self.path)
        proxy_path = path.path[len("/api/controller"):]
        if not proxy_path:
            proxy_path = "/"
        target_url = f"{CONTROLLER_BASE}{proxy_path}"
        if path.query:
            target_url = f"{target_url}?{path.query}"

        body = None
        if self.command in {"POST", "PUT", "PATCH"}:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length) if length > 0 else None

        headers = {}
        for key, value in self.headers.items():
            lower = key.lower()
            if lower in {"host", "origin", "referer", "content-length", "connection", "accept-encoding"}:
                continue
            headers[key] = value

        request = Request(target_url, data=body, headers=headers, method=self.command)
        timeout_seconds = 20 if self.command in {"POST", "PUT", "PATCH"} else 5
        body_len = len(body) if body is not None else 0
        log_line("INFO", f"proxy request method={self.command} target={target_url} body_bytes={body_len} timeout={timeout_seconds}s")

        try:
            with DIRECT_OPENER.open(request, timeout=timeout_seconds) as response:
                data = response.read()
                status = response.getcode() or 200
                log_line("INFO", f"proxy success status={status} target={target_url} response_bytes={len(data)}")
                content_type = response.headers.get_content_type()
                if response.headers.get_content_subtype():
                    content_type = response.headers.get("Content-Type", content_type)
                self.send_response(status)
                for key, value in response.headers.items():
                    lower = key.lower()
                    if lower in {
                        "content-length",
                        "content-type",
                        "connection",
                        "transfer-encoding",
                        "content-encoding",
                        "date",
                        "server",
                    }:
                        continue
                    self.send_header(key, value)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as exc:
            data = exc.read() or b""
            detail_preview = data.decode("utf-8", errors="replace")[:400]
            log_line("ERROR", f"proxy HTTPError status={exc.code} target={target_url} detail={detail_preview}")
            self.send_response(exc.code)
            for key, value in (exc.headers or {}).items():
                lower = key.lower()
                if lower in {"content-length", "content-type", "connection", "transfer-encoding", "content-encoding"}:
                    continue
                self.send_header(key, value)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Content-Type", exc.headers.get_content_type() if exc.headers else "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except URLError as exc:
            log_line("ERROR", f"proxy URLError target={target_url} detail={exc}")
            self._send_json(
                {
                    "error": "controller_unreachable",
                    "controller_base": CONTROLLER_BASE,
                    "detail": str(exc),
                },
                status=HTTPStatus.BAD_GATEWAY,
            )
        except Exception as exc:
            log_exception(f"proxy unexpected target={target_url}", exc)
            self._send_json(
                {
                    "error": "controller_proxy_failed",
                    "controller_base": CONTROLLER_BASE,
                    "detail": str(exc),
                },
                status=HTTPStatus.BAD_GATEWAY,
            )

    def _publish_saved_config(self):
        payload, error, status = self._load_saved_config()
        if error:
            self._send_json(error, status=status)
            return

        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        target_url = f"{CONTROLLER_BASE}/config/import"
        request = Request(
            target_url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        log_line("INFO", f"publish saved config target={target_url} body_bytes={len(body)}")
        try:
            with DIRECT_OPENER.open(request, timeout=20) as response:
                data = response.read()
                log_line("INFO", f"publish success status={response.getcode() or 200} target={target_url} response_bytes={len(data)}")
                try:
                    controller_reply = json.loads(data.decode("utf-8") or "{}")
                except Exception:
                    controller_reply = {"raw": data.decode("utf-8", errors="replace")}
                self._send_json(
                    {
                        "ok": True,
                        "controller_base": CONTROLLER_BASE,
                        "controller_reply": controller_reply,
                    }
                )
        except HTTPError as exc:
            data = exc.read() or b""
            log_line("ERROR", f"publish HTTPError status={exc.code} target={target_url} detail={data.decode('utf-8', errors='replace')[:400]}")
            self._send_json(
                {
                    "error": "controller_rejected_import",
                    "status": exc.code,
                    "controller_base": CONTROLLER_BASE,
                    "detail": data.decode("utf-8", errors="replace"),
                },
                status=HTTPStatus.BAD_GATEWAY,
            )
        except Exception as exc:
            log_exception(f"publish unexpected target={target_url}", exc)
            self._send_json(
                {
                    "error": "controller_publish_failed",
                    "controller_base": CONTROLLER_BASE,
                    "detail": str(exc),
                },
                status=HTTPStatus.BAD_GATEWAY,
            )

    def do_OPTIONS(self):
        log_line("DEBUG", f"OPTIONS {self.path}")
        if self.path.startswith("/api/controller"):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        log_line("DEBUG", f"GET {path}")
        if path.startswith("/api/controller"):
            self._proxy_controller()
            return

        if path == "/api/log":
            query = urlparse(self.path).query
            tail = 200
            if "tail=" in query:
                try:
                    tail = max(10, min(5000, int(query.split("tail=", 1)[1].split("&", 1)[0])))
                except Exception:
                    tail = 200
            lines: list[str] = []
            try:
                if LOG_FILE.exists():
                    with LOG_FILE.open("r", encoding="utf-8", errors="replace") as f:
                        lines = f.readlines()
            except Exception as exc:
                self._send_json({"error": "read_log_failed", "detail": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            data = "".join(lines[-tail:]).encode("utf-8", errors="replace")
            self._send_bytes(data, content_type="text/plain; charset=utf-8")
            return

        if path == "/api/load":
            payload, error, status = self._load_saved_config()
            if error:
                self._send_json(error, status=status)
                return
            self._send_json(payload)
            return

        if path == "/api/status":
            local_state = _load_local_state()
            self._send_json(
                {
                    "ok": True,
                    "server": "magic-wand-lan-config",
                    "version": "0.4.6",
                    "port": PORT,
                    "saved": CONFIG_FILE.exists(),
                    "path": str(CONFIG_FILE),
                    "local_state_path": str(LOCAL_STATE_FILE),
                    "room_record_path": str(ROOM_RECORD_FILE),
                    "log_path": str(LOG_FILE),
                    "size": CONFIG_FILE.stat().st_size if CONFIG_FILE.exists() else 0,
                    "local_state_size": LOCAL_STATE_FILE.stat().st_size if LOCAL_STATE_FILE.exists() else 0,
                    "room_record_size": ROOM_RECORD_FILE.stat().st_size if ROOM_RECORD_FILE.exists() else 0,
                    "device_drafts": len(local_state.get("device_drafts", {}) or {}),
                    "templates": len(local_state.get("templates", []) or []),
                    "room_history": len(local_state.get("room_history", []) or []),
                    "controller_base": CONTROLLER_BASE,
                }
            )
            return

        if path == "/api/local/state":
            payload = _load_local_state()
            self._send_json(payload)
            return

        if path == "/api/local/records":
            query = urlparse(self.path).query
            tail = 100
            if "tail=" in query:
                try:
                    tail = max(1, min(5000, int(query.split("tail=", 1)[1].split("&", 1)[0])))
                except Exception:
                    tail = 100
            self._send_json(
                {
                    "ok": True,
                    "records": _load_room_records(tail=tail),
                    "path": str(ROOM_RECORD_FILE),
                }
            )
            return

        if path in {"/", "/index.html"}:
            self._serve_index_html()
            return
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        log_line("DEBUG", f"POST {path}")
        if path == "/api/log/clear":
            try:
                LOG_FILE.write_text("", encoding="utf-8")
                self._send_json({"ok": True, "cleared": str(LOG_FILE)})
            except Exception as exc:
                self._send_json({"error": "clear_log_failed", "detail": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/save":
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode("utf-8"))
            except Exception as exc:
                log_exception("api/save invalid json", exc)
                self._send_json({"error": "invalid_json", "detail": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return

            CONFIG_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            log_line("INFO", f"save local config bytes={CONFIG_FILE.stat().st_size}")
            self._send_json(
                {
                    "ok": True,
                    "saved": str(CONFIG_FILE.name),
                    "bytes": CONFIG_FILE.stat().st_size,
                }
            )
            return

        if path == "/api/local/state":
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode("utf-8"))
                saved = _save_local_state(payload)
            except Exception as exc:
                log_exception("api/local/state save failed", exc)
                self._send_json({"error": "invalid_local_state", "detail": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self._send_json(
                {
                    "ok": True,
                    "saved": str(LOCAL_STATE_FILE.name),
                    "bytes": LOCAL_STATE_FILE.stat().st_size,
                    "state": saved,
                }
            )
            return

        if path == "/api/local/records":
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode("utf-8"))
                record = _append_room_record(payload)
            except Exception as exc:
                log_exception("api/local/records append failed", exc)
                self._send_json({"error": "invalid_room_record", "detail": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return
            self._send_json(
                {
                    "ok": True,
                    "saved": str(ROOM_RECORD_FILE.name),
                    "bytes": ROOM_RECORD_FILE.stat().st_size,
                    "record": record,
                }
            )
            return

        if path == "/api/publish":
            self._publish_saved_config()
            return

        if path.startswith("/api/controller"):
            self._proxy_controller()
            return

        self._send_json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)


def main():
    log_line("INFO", f"server start host={HOST} port={PORT} controller_base={CONTROLLER_BASE}")
    server = ThreadingHTTPServer((HOST, PORT), ConfigHandler)
    print(f"Local config page starting at http://{HOST}:{PORT}/")
    print(f"Controller proxy target: {CONTROLLER_BASE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log_line("INFO", "server stopped by KeyboardInterrupt")
        pass
    finally:
        log_line("INFO", "server closed")
        server.server_close()


if __name__ == "__main__":
    main()
