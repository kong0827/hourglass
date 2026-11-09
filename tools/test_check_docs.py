#!/usr/bin/env python3
"""本地 Markdown 链接解析回归测试，仅使用临时目录。"""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote


SPEC = importlib.util.spec_from_file_location(
    "check_docs", Path(__file__).with_name("check-docs.py")
)
check_docs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_docs)


class CheckLinksTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.docs = self.root / "docs"
        self.frontend = self.root / "frontend"
        self.docs.mkdir()
        self.frontend.mkdir()
        roots = patch.multiple(
            check_docs,
            ROOT=str(self.root),
            DOCS=str(self.docs),
            FRONTEND=str(self.frontend),
        )
        roots.start()
        self.addCleanup(roots.stop)
        # 任何网络访问都应使测试失败，而不是访问真实服务。
        for name in ("urllib.request.urlopen", "socket.create_connection"):
            network = patch(name, side_effect=AssertionError("不允许网络访问"))
            network.start()
            self.addCleanup(network.stop)

    def check(self, target, folder=None):
        folder = self.docs if folder is None else folder
        (folder / "check.md").write_text("[目标](%s)\n" % target, encoding="utf-8")
        issues = []
        check_docs.check_links(issues)
        return issues

    def assert_missing(self, issues, target):
        self.assertEqual(issues, ["docs/check.md 链接目标不存在：%s" % target])

    def test_existing_file_uri(self):
        target = self.root / "source.py"
        target.touch()
        for host in ("", "localhost", "LOCALHOST"):
            with self.subTest(host=host):
                self.assertEqual(self.check("file://" + host + str(target)), [])

    def test_missing_file_uri(self):
        target = self.root / "missing.py"
        for host in ("", "localhost"):
            with self.subTest(host=host):
                self.assert_missing(self.check("file://" + host + str(target)), target)

    def test_file_uri_decodes_path_and_removes_query_fragment(self):
        target = self.root / "源码 空格+#问号?.py"
        target.touch()
        for host in ("", "localhost"):
            with self.subTest(host=host):
                uri = "file://" + host + quote(str(target)) + "?view=source#L59-L71"
                self.assertEqual(self.check(uri), [])

    def test_missing_encoded_file_uri(self):
        target = self.root / "缺失 文件.py"
        uri = target.as_uri() + "?view=source#L59"
        self.assert_missing(self.check(uri), target)

    def test_relative_encoded_path(self):
        target = self.docs / "资源" / "中文 空格+#问号?.txt"
        target.parent.mkdir()
        target.touch()
        relative = str(target.relative_to(self.docs))
        self.assertEqual(self.check(quote(relative) + "?download=1#L20"), [])

    def test_relative_filename_with_colon(self):
        target = self.docs / "source:part.txt"
        target.touch()
        self.assertEqual(self.check(target.name + "?view=source#L1"), [])
        self.assert_missing(self.check("missing:part.txt#L1"), "missing:part.txt")

    def test_missing_relative_encoded_path(self):
        relative = "资源/缺失 文件.txt"
        self.assert_missing(self.check(quote(relative) + "?download=1#L20"), relative)

    def test_plain_relative_fragment(self):
        target = self.docs / "source.txt"
        target.touch()
        self.assertEqual(self.check("source.txt#L20"), [])
        self.assert_missing(self.check("missing.txt#L20"), "missing.txt")

    def test_frontend_links_are_checked(self):
        target = self.frontend / "中文 文件.txt"
        target.touch()
        self.assertEqual(self.check(quote(target.name) + "#L1", self.frontend), [])
        target.unlink()
        self.assertEqual(
            self.check(quote(target.name) + "#L1", self.frontend),
            ["frontend/check.md 链接目标不存在：中文 文件.txt"],
        )

    def test_remote_file_uri_is_rejected_before_existence_check(self):
        target = self.root / "source.py"
        target.touch()
        for host in ("remote.example", "127.0.0.1", "localhost:80", "user@localhost"):
            with self.subTest(host=host):
                uri = "file://" + host + str(target) + "#L1"
                with patch.object(check_docs.os.path, "exists") as exists:
                    self.assertEqual(
                        self.check(uri),
                        ["docs/check.md 使用非本地主机 file URI：%s" % uri],
                    )
                    exists.assert_not_called()

    def test_external_and_anchor_links_are_ignored(self):
        for target in (
            "http://example.invalid/missing#L1",
            "https://example.invalid/missing?download=1#L1",
            "mailto:user@example.invalid",
            "tel:123456",
            "#section",
        ):
            with self.subTest(target=target):
                with patch.object(check_docs.os.path, "exists") as exists:
                    self.assertEqual(self.check(target), [])
                    exists.assert_not_called()

    def test_bare_absolute_links_remain_rejected(self):
        target = self.root / "source.py"
        target.touch()
        for link in (str(target), str(target) + "#L1", "/missing.py", "//remote/path"):
            with self.subTest(link=link):
                self.assertEqual(
                    self.check(link),
                    ["docs/check.md 使用绝对路径链接：%s" % link],
                )

    def test_encoded_absolute_path_cannot_bypass_rejection(self):
        target = self.root / "source.py"
        target.touch()
        self.assertEqual(
            self.check(quote(str(target), safe="") + "#L1"),
            ["docs/check.md 使用绝对路径链接：%s" % target],
        )

    def test_malformed_file_uri_reports_an_issue(self):
        uri = "file://[invalid/path"
        self.assertEqual(self.check(uri), ["docs/check.md 链接格式无效：%s" % uri])


if __name__ == "__main__":
    unittest.main()
