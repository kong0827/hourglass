package com.hourglass.service;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 正文中的文档引用解析：Markdown 用 [标题](hgdoc://id)，富文本用 data-hg-ref="doc:id" 或 href="hgdoc://id"。
 * 解析失败按普通文本处理，不阻塞保存；同篇引用去重、排除自引用，上限 200 个。
 */
public final class DocLinkParser {

    private static final Pattern HREF = Pattern.compile("hgdoc://([A-Za-z0-9_-]{1,64})");
    private static final Pattern DATA_REF = Pattern.compile("data-hg-ref=\"doc:([A-Za-z0-9_-]{1,64})\"");
    private static final int MAX_REFS = 200;

    private DocLinkParser() {
    }

    public static Set<String> extract(String content, String selfDocId) {
        Set<String> ids = new LinkedHashSet<>();
        if (content != null) {
            collect(HREF.matcher(content), ids, selfDocId);
            collect(DATA_REF.matcher(content), ids, selfDocId);
        }
        return ids;
    }

    private static void collect(Matcher m, Set<String> ids, String selfDocId) {
        while (m.find() && ids.size() < MAX_REFS) {
            String id = m.group(1);
            if (!id.equals(selfDocId)) {
                ids.add(id);
            }
        }
    }
}
