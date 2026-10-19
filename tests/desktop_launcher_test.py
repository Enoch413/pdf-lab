from html.parser import HTMLParser
import importlib.util
from pathlib import Path
import runpy
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urljoin, urlparse, unquote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


class DesktopRuntimeTests(unittest.TestCase):
    def test_package_contains_web_dependencies(self):
        captured = {}

        def analysis(*args, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(pure=[], scripts=[], binaries=[], datas=kwargs["datas"])

        runpy.run_path(str(ROOT / "app/PdfProblemTemplateRepacker.spec"), init_globals={
            "SPECPATH": str(ROOT / "app"), "Analysis": analysis, "PYZ": lambda *_: None,
            "EXE": lambda *args, **kwargs: None,
        })
        packaged = set()
        for source, destination in captured["datas"]:
            source = Path(source)
            if source.is_file():
                packaged.add((Path(destination) / source.name).as_posix().removeprefix("./"))
            else:
                packaged.update((Path(destination) / path.relative_to(source)).as_posix() for path in source.rglob("*") if path.is_file())

        class References(HTMLParser):
            def __init__(self):
                super().__init__()
                self.refs = []

            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag in {"script", "link", "img", "a"}:
                    value = attrs.get("src") or attrs.get("href")
                    if value:
                        self.refs.append(value)

        for name in ["index.html", "app/index.html", "app/final_test.html", "app/general_exam.html",
                     "dist/solbook_question_maker_portable/app/solbook_question_maker.html"]:
            self.assertIn(name, packaged)
            parser = References()
            parser.feed((ROOT / name).read_text(encoding="utf-8"))
            for ref in parser.refs:
                url = urlparse(urljoin("http://local/" + name, ref))
                if url.netloc == "local":
                    self.assertIn(unquote(url.path).lstrip("/"), packaged, name + " -> " + ref)

    @unittest.skipUnless(sys.platform == "win32", "Windows desktop launcher")
    def test_fallback_keeps_server_until_user_finishes(self):
        spec = importlib.util.spec_from_file_location("launcher", ROOT / "app/desktop_launcher.py")
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("temporary runtime", encoding="utf-8")
            urls = []

            def notice():
                with urlopen(urls[0], timeout=3) as response:
                    self.assertEqual(response.status, 200, "Server must survive the browser fallback")

            fake_webview = SimpleNamespace(settings={}, create_window=Mock(side_effect=RuntimeError("injected")))
            with patch.multiple(launcher, APP_PORT=0, webview=fake_webview,
                                ensure_webview2_runtime=lambda: True, get_app_root=lambda: root,
                                ensure_portable_storage_root=lambda: root, launch_fallback_browser=urls.append,
                                show_fallback_notice=notice):
                launcher.main()
            with self.assertRaises(OSError):
                urlopen(urls[0], timeout=1)


if __name__ == "__main__":
    unittest.main()
