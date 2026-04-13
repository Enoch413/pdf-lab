from __future__ import annotations

import atexit
import ctypes
import sys
import threading
import webbrowser
import winreg
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import webview


APP_FILE = "index.html"
WINDOW_TITLE = "\ubb38\uc81c \ub9ac\ud328\ud0a4\uc9d5"
WINDOW_SIZE = (1500, 980)
MIN_SIZE = (1180, 760)
APP_HOST = "127.0.0.1"
APP_PORT = 38473
WEBVIEW2_RUNTIME_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
WEBVIEW2_DOWNLOAD_URL = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"

MB_OK = 0x00000000
MB_YESNO = 0x00000004
MB_ICONINFORMATION = 0x00000040
MB_ICONWARNING = 0x00000030
IDYES = 6


def get_app_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def get_runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def ensure_portable_storage_root() -> Path:
    storage_root = get_runtime_root() / "PdfProblemTemplateRepacker_Library"
    storage_root.mkdir(parents=True, exist_ok=True)

    readme_path = storage_root / "README.txt"
    if not readme_path.exists():
        readme_path.write_text(
            "PdfProblemTemplateRepacker library data folder.\n"
            "Copy this folder together with the EXE to move saved textbooks,\n"
            "problem library records, and exam history to another computer.\n",
            encoding="utf-8",
        )

    return storage_root


def create_server(root: Path) -> tuple[ThreadingHTTPServer, str]:
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    try:
        server = ThreadingHTTPServer((APP_HOST, APP_PORT), handler)
    except OSError as error:
        raise RuntimeError(
            f"앱 내부 서버 포트 {APP_PORT}를 열지 못했습니다. "
            "프로그램을 하나만 실행 중인지 확인한 뒤 다시 시도해주세요."
        ) from error
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    url = f"http://{APP_HOST}:{APP_PORT}/{APP_FILE}"
    return server, url


def show_message(message: str, flags: int) -> int:
    return int(ctypes.windll.user32.MessageBoxW(0, message, WINDOW_TITLE, flags))


def read_registry_value(root: int, subkey: str, value_name: str) -> str | None:
    try:
        with winreg.OpenKey(root, subkey) as key:
            value, _ = winreg.QueryValueEx(key, value_name)
    except OSError:
        return None
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def is_valid_webview2_version(value: str | None) -> bool:
    if not value:
        return False
    if value == "0.0.0.0":
        return False
    parts = value.split(".")
    if len(parts) < 4:
        return False
    return all(part.isdigit() for part in parts[:4])


def get_installed_webview2_version() -> str | None:
    subkeys = (
        rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_RUNTIME_GUID}",
        rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_RUNTIME_GUID}",
    )
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for subkey in subkeys:
            version = read_registry_value(root, subkey, "pv")
            if is_valid_webview2_version(version):
                return version
    return None


def ensure_webview2_runtime() -> bool:
    if get_installed_webview2_version():
        return True

    message = (
        "\uc774 \ud504\ub85c\uadf8\ub7a8\uc740 \uac00\uc7a5 \uc815\ud655\ud55c \ub808\uc774\uc544\uc6c3\uacfc PDF \ucd9c\ub825\uc744 \uc704\ud574 "
        "Microsoft Edge WebView2 Runtime\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.\n\n"
        "\uc9c0\uae08 Microsoft \uacf5\uc2dd \uc124\uce58 \ud398\uc774\uc9c0\ub97c \uc5f4\uae4c\uc694?\n"
        "\uc124\uce58\uac00 \ub05d\ub098\uba74 EXE\ub97c \ub2e4\uc2dc \uc2e4\ud589\ud558\uba74 \ub429\ub2c8\ub2e4."
    )
    response = show_message(message, MB_YESNO | MB_ICONINFORMATION)
    if response == IDYES:
        webbrowser.open(WEBVIEW2_DOWNLOAD_URL)
        show_message(
            "\uacf5\uc2dd WebView2 \ub2e4\uc6b4\ub85c\ub4dc \ud398\uc774\uc9c0\ub97c \uc5f4\uc5c8\uc2b5\ub2c8\ub2e4.\n\n"
            "\ub7f0\ud0c0\uc784 \uc124\uce58 \ud6c4 \uc774 EXE\ub97c \ub2e4\uc2dc \uc2e4\ud589\ud574\uc8fc\uc138\uc694.",
            MB_OK | MB_ICONINFORMATION,
        )
    return False


def launch_fallback_browser(url: str) -> None:
    webbrowser.open(url)


def show_fallback_notice() -> None:
    message = (
        "\ub0b4\uc7a5 WebView2 \ucc3d\uc744 \uc5f4\uc9c0 \ubabb\ud574 \uae30\ubcf8 \ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c \uc2e4\ud589\ud588\uc2b5\ub2c8\ub2e4.\n\n"
        "\ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c\ub3c4 \uc0ac\uc6a9\uc740 \uac00\ub2a5\ud558\uc9c0\ub9cc, \uc778\uc1c4\u00b7PDF \ucd9c\ub825 \uacb0\uacfc\ub294 "
        "WebView2 \ud658\uacbd\uc5d0\uc11c \uac00\uc7a5 \uc815\ud655\ud569\ub2c8\ub2e4."
    )
    show_message(message, MB_OK | MB_ICONWARNING)


def main() -> None:
    if not ensure_webview2_runtime():
        return

    app_root = get_app_root()
    storage_root = ensure_portable_storage_root()
    entry_file = app_root / APP_FILE
    if not entry_file.exists():
        raise FileNotFoundError(f"Cannot find app entry: {entry_file}")

    server, url = create_server(app_root)
    atexit.register(server.shutdown)
    atexit.register(server.server_close)

    try:
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        webview.create_window(
            WINDOW_TITLE,
            url=url,
            width=WINDOW_SIZE[0],
            height=WINDOW_SIZE[1],
            min_size=MIN_SIZE,
            text_select=True,
        )
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(storage_root))
    except Exception:
        launch_fallback_browser(url)
        show_fallback_notice()


if __name__ == "__main__":
    main()
