package com.hourglass.service;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class DocLinkParserTest {

    @Test
    public void extractsMarkdownLinks() {
        Set<String> ids = DocLinkParser.extract(
                "见 [设计文档](hgdoc://D111) 与 [排期](hgdoc://D222)，普通链接 [外站](https://x.com) 不算", "D000");
        assertEquals(new HashSet<>(Arrays.asList("D111", "D222")), ids);
    }

    @Test
    public void extractsRichTextRefs() {
        Set<String> ids = DocLinkParser.extract(
                "<p><a href=\"hgdoc://D333\" data-hg-ref=\"doc:D333\">目标</a>"
                        + "<a data-hg-ref=\"doc:D444\">另一个</a></p>", "D000");
        assertEquals(new HashSet<>(Arrays.asList("D333", "D444")), ids);
    }

    @Test
    public void dedupesAndSkipsSelf() {
        Set<String> ids = DocLinkParser.extract(
                "[a](hgdoc://D1) [b](hgdoc://D1) [self](hgdoc://D9)", "D9");
        assertEquals(new HashSet<>(Arrays.asList("D1")), ids);
    }

    @Test
    public void emptyAndNullContent() {
        assertTrue(DocLinkParser.extract(null, "D9").isEmpty());
        assertTrue(DocLinkParser.extract("没有引用", "D9").isEmpty());
    }

    @Test
    public void ignoresMalformedTargets() {
        Set<String> ids = DocLinkParser.extract(
                "[a](hgdoc://) [b](hgdoc://有空格) [c](hgdoc://D5)", "D9");
        assertEquals(new HashSet<>(Arrays.asList("D5")), ids);
    }
}
