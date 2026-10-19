from __future__ import annotations

import argparse
import base64
import io
import json
import os
import shutil
import socket
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from PIL import Image, ImageFilter, ImageOps

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    cv2 = None

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    np = None

try:
    import pytesseract  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    pytesseract = None


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8762
OCR_LANGUAGE = "kor+eng"
OCR_CONFIG = "--oem 3 --psm 6 preserve_interword_spaces=1"
OCR_STATUS_CACHE: dict[str, Any] | None = None
MAX_OCR_REQUEST_BYTES = 32 * 1024 * 1024
MAX_OCR_IMAGES = 40
OCR_IMAGE_TIMEOUT = 20
OCR_REQUEST_TIMEOUT = 120


def resolve_tesseract_cmd() -> str | None:
    env_candidates = [
        os.environ.get("PDFLAB_TESSERACT_CMD", "").strip(),
        os.environ.get("TESSERACT_CMD", "").strip(),
        os.environ.get("TESSERACT_EXE", "").strip(),
    ]
    for candidate in env_candidates:
        if candidate and Path(candidate).exists():
            return candidate

    which_candidate = shutil.which("tesseract")
    if which_candidate:
        return which_candidate

    static_candidates = [
        Path("C:/Program Files/Tesseract-OCR/tesseract.exe"),
        Path("C:/Program Files (x86)/Tesseract-OCR/tesseract.exe"),
        Path.home() / "AppData/Local/Programs/Tesseract-OCR/tesseract.exe",
        Path.home() / "scoop/apps/tesseract/current/tesseract.exe",
    ]
    for candidate in static_candidates:
        if candidate.exists():
            return str(candidate)

    local_programs = Path(os.environ.get("LOCALAPPDATA", "")).expanduser() / "Programs"
    if local_programs.exists():
        for candidate in local_programs.glob("**/tesseract.exe"):
            if candidate.exists():
                return str(candidate)

    return None


def get_ocr_status(force_refresh: bool = False) -> dict[str, Any]:
    global OCR_STATUS_CACHE
    if OCR_STATUS_CACHE is not None and not force_refresh:
        return dict(OCR_STATUS_CACHE)

    if pytesseract is None:
        OCR_STATUS_CACHE = {
            "available": False,
            "error": "pytesseract 패키지를 불러오지 못했습니다.",
            "tesseractCmd": "",
            "languages": [],
        }
        return dict(OCR_STATUS_CACHE)

    tesseract_cmd = resolve_tesseract_cmd()
    if not tesseract_cmd:
        OCR_STATUS_CACHE = {
            "available": False,
            "error": "tesseract.exe를 찾지 못했습니다. PATH에 추가하거나 PDFLAB_TESSERACT_CMD 환경 변수에 경로를 지정해주세요.",
            "tesseractCmd": "",
            "languages": [],
        }
        return dict(OCR_STATUS_CACHE)

    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    try:
        version = str(pytesseract.get_tesseract_version())
        languages = sorted(pytesseract.get_languages(config=""))
    except Exception as error:  # pragma: no cover - runtime environment dependent
        OCR_STATUS_CACHE = {
            "available": False,
            "error": f"Tesseract OCR 초기화에 실패했습니다: {error}",
            "tesseractCmd": tesseract_cmd,
            "languages": [],
        }
        return dict(OCR_STATUS_CACHE)

    OCR_STATUS_CACHE = {
        "available": True,
        "error": "",
        "tesseractCmd": tesseract_cmd,
        "languages": languages,
        "version": version,
    }
    return dict(OCR_STATUS_CACHE)


def decode_data_url(data_url: str) -> bytes:
    raw = str(data_url or "")
    if not raw.startswith("data:") or "," not in raw:
        raise ValueError("올바른 data URL 이미지가 아닙니다.")
    _, encoded = raw.split(",", 1)
    return base64.b64decode(encoded)


def preprocess_image(image: Image.Image) -> Image.Image:
    prepared = image.convert("RGB")
    scale = 3 if max(prepared.size) < 1200 else 2
    prepared = prepared.resize((prepared.width * scale, prepared.height * scale), Image.Resampling.LANCZOS)
    prepared = ImageOps.grayscale(prepared)
    prepared = ImageOps.autocontrast(prepared)
    prepared = prepared.filter(ImageFilter.SHARPEN)

    if cv2 is not None and np is not None:
        matrix = np.array(prepared)
        matrix = cv2.GaussianBlur(matrix, (3, 3), 0)
        _, matrix = cv2.threshold(matrix, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return Image.fromarray(matrix)

    return prepared.point(lambda value: 255 if value > 170 else 0, mode="1").convert("L")


def run_ocr_for_data_url(data_url: str) -> str:
    image = Image.open(io.BytesIO(decode_data_url(data_url)))
    if image.width * image.height > 12_000_000:
        raise ValueError("OCR 이미지는 1,200만 픽셀 이하여야 합니다.")
    processed = preprocess_image(image)
    text = pytesseract.image_to_string(processed, lang=OCR_LANGUAGE, config=OCR_CONFIG, timeout=OCR_IMAGE_TIMEOUT)
    return str(text or "").strip()


class PdfLabHTTPServer(ThreadingHTTPServer):
    def server_bind(self) -> None:
        if os.name == "nt":
            # Windows SO_REUSEADDR can send requests to another, older listener.
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class PdfLabRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=directory or str(PROJECT_ROOT), **kwargs)

    def trusted_host(self, value: str) -> bool:
        try:
            host = urlparse("//" + value).hostname
        except ValueError:
            return False
        return host in {"localhost", "127.0.0.1", "::1", self.server.server_address[0]}

    def send_head(self):
        if not self.trusted_host(self.headers.get("Host", "")):
            self.send_error(403, "Untrusted host")
            return None
        root = Path(self.directory).resolve()
        path = unquote(urlparse(self.path).path)
        target = (root / path.lstrip("/")).resolve()
        try:
            parts = target.relative_to(root).parts
        except ValueError:
            parts = ()
        if target == root:
            target = root / "index.html"
            parts = ("index.html",)
        web_root = parts == ("index.html",) or (
            len(parts) >= 2 and parts[0] in {"app", "shared"} and
            (len(parts) == 2 or parts[1] in {"assets", "vendor"})
        ) or (len(parts) >= 4 and parts[:3] == ("dist", "solbook_question_maker_portable", "app"))
        if not web_root or any(part.startswith(".") for part in parts) or not target.is_file() or target.suffix.lower() not in {
            ".html", ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico", ".ttf", ".woff", ".woff2"
        }:
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def end_headers(self) -> None:
        parsed = urlparse(self.path)
        request_path = parsed.path.lower()
        if request_path.endswith((".html", ".css", ".js")) or request_path in ("", "/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if status_code >= 400:
            # Rejected requests may still have an unread body on HTTP/1.1.
            self.close_connection = True
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if not self.trusted_host(self.headers.get("Host", "")):
            self.send_json(403, {"ok": False, "error": "허용하지 않은 호스트입니다."})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/ocr-status":
            self.send_json(200, get_ocr_status())
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if not self.trusted_host(self.headers.get("Host", "")):
            self.send_json(403, {"ok": False, "error": "허용하지 않은 호스트입니다."})
            return
        origin = self.headers.get("Origin")
        if origin:
            parsed_origin = urlparse(origin)
            try:
                trusted_origin = self.trusted_host(parsed_origin.netloc) and parsed_origin.scheme == "http" and (
                    parsed_origin.port or 80) == self.server.server_address[1]
            except ValueError:
                trusted_origin = False
            if not trusted_origin:
                self.send_json(403, {"ok": False, "error": "다른 사이트의 OCR 요청은 허용하지 않습니다."})
                return
        parsed = urlparse(self.path)
        if parsed.path != "/api/ocr-answer-blocks":
            self.send_json(404, {"ok": False, "error": "지원하지 않는 API 경로입니다."})
            return

        status = get_ocr_status()
        if not status.get("available"):
            self.send_json(503, {"ok": False, "error": status.get("error") or "로컬 OCR을 사용할 수 없습니다."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length <= 0:
                raise ValueError("유효한 Content-Length가 필요합니다.")
            if length > MAX_OCR_REQUEST_BYTES:
                self.close_connection = True
                self.send_json(413, {"ok": False, "error": "OCR 요청은 32MiB 이하여야 합니다."})
                return
            self.connection.settimeout(OCR_IMAGE_TIMEOUT)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as error:
            self.send_json(400, {"ok": False, "error": f"요청 JSON을 읽지 못했습니다: {error}"})
            return

        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            self.send_json(400, {"ok": False, "error": "items 배열이 필요합니다."})
            return

        if any(not isinstance(item, dict) or not isinstance(item.get("images"), list) or
               any(not isinstance(image, str) or not image.startswith("data:image/") for image in item["images"])
               for item in items):
            self.send_json(400, {"ok": False, "error": "각 항목에는 이미지 data URL의 images 배열이 필요합니다."})
            return
        if len(items) > MAX_OCR_IMAGES or sum(len(item["images"]) for item in items) > MAX_OCR_IMAGES:
            self.send_json(400, {"ok": False, "error": "OCR은 한 요청에 최대 40개 이미지를 처리합니다."})
            return

        results = []
        started = time.monotonic()
        for item in items:
            problem_id = str(item.get("problemId") or "")
            number = item.get("number")
            images = item.get("images")
            if not isinstance(images, list) or not images:
                results.append({
                    "problemId": problem_id,
                    "number": number,
                    "texts": [],
                    "error": "OCR 이미지가 없습니다.",
                })
                continue

            texts = []
            error_message = ""
            for image_data_url in images:
                if time.monotonic() - started > OCR_REQUEST_TIMEOUT:
                    self.send_json(408, {"ok": False, "error": "OCR 처리 시간이 초과되었습니다. 더 적은 문항으로 다시 시도해주세요."})
                    return
                try:
                    text = run_ocr_for_data_url(str(image_data_url or ""))
                except Exception as error:  # pragma: no cover - runtime environment dependent
                    error_message = str(error)
                    continue
                if text:
                    texts.append(text)

            results.append({
                "problemId": problem_id,
                "number": number,
                "texts": texts,
                "error": error_message,
            })

        self.send_json(200, {"ok": True, "results": results, "ocr": get_ocr_status()})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local PDF LAB static server with OCR endpoints.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind. Default: 8762")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = PdfLabHTTPServer((args.host, args.port), PdfLabRequestHandler)
    try:
        print(f"PDF LAB local server running at http://{args.host}:{args.port}")
        ocr_status = get_ocr_status()
        if ocr_status.get("available"):
            print(f"OCR ready: {ocr_status.get('tesseractCmd')}")
        else:
            print(f"OCR unavailable: {ocr_status.get('error')}")
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
