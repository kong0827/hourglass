package com.hourglass.service;

import com.hourglass.entity.RequirementDoc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 从文档正文提取标题序列（按文档顺序），与前端阅读大纲同一口径：
 * HTML 取 h1–h6，Markdown 取 ATX（# …）与 Setext（=== / ---）标题，跳过围栏代码块。
 * 在线文档（univer）与表格（sheet）正文是快照 JSON，不提取。
 * 返回列表的下标即阅读大纲里的标题序号，配合 ?h= 深链直达该节。
 */
final class DocHeadings {

    private static final Pattern HTML_HEADING =
            Pattern.compile("<h([1-6])\\b[^>]*>(.*?)</h\\1>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern TAG = Pattern.compile("<[^>]+>");
    private static final Pattern ATX = Pattern.compile("^ {0,3}(#{1,6})[ \\t]+(.*?)[ \\t]*#*[ \\t]*$");
    private static final Pattern SETEXT = Pattern.compile("^ {0,3}(=+|-+)[ \\t]*$");
    private static final Pattern ENTITY = Pattern.compile("&(#x?[0-9a-fA-F]+|\\w+);");

    private DocHeadings() {
    }

    static List<String> of(RequirementDoc doc) {
        if (doc == null) {
            return Collections.emptyList();
        }
        if ("html".equals(doc.getFormat())) {
            return fromHtml(doc.getContent());
        }
        if ("markdown".equals(doc.getFormat())) {
            return fromMarkdown(doc.getContent());
        }
        return Collections.emptyList();
    }

    static List<String> fromHtml(String html) {
        if (html == null || html.isEmpty()) {
            return Collections.emptyList();
        }
        List<String> out = new ArrayList<String>();
        Matcher m = HTML_HEADING.matcher(html);
        while (m.find()) {
            String text = clean(m.group(2));
            if (!text.isEmpty()) {
                out.add(text);
            }
        }
        return out;
    }

    static List<String> fromMarkdown(String md) {
        if (md == null || md.isEmpty()) {
            return Collections.emptyList();
        }
        List<String> out = new ArrayList<String>();
        String[] lines = md.split("\n", -1);
        boolean inFence = false;
        String prevText = null;
        for (String raw : lines) {
            String line = raw.endsWith("\r") ? raw.substring(0, raw.length() - 1) : raw;
            String fence = line.trim();
            if (fence.startsWith("```") || fence.startsWith("~~~")) {
                inFence = !inFence;
                prevText = null;
                continue;
            }
            if (inFence) {
                continue;
            }
            Matcher atx = ATX.matcher(line);
            if (atx.matches()) {
                String text = clean(atx.group(2));
                if (!text.isEmpty()) {
                    out.add(text);
                }
                prevText = null;
                continue;
            }
            Matcher setext = SETEXT.matcher(line);
            if (setext.matches() && prevText != null) {
                out.add(clean(prevText));
                prevText = null;
                continue;
            }
            String trimmed = line.trim();
            prevText = trimmed.isEmpty() ? null : trimmed;
        }
        return out;
    }

    /** 去标签、解常见实体、收空白；标题里的行内样式（strong 等）只留文字 */
    private static String clean(String html) {
        String text = TAG.matcher(html == null ? "" : html).replaceAll("");
        Matcher m = ENTITY.matcher(text);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(decode(m.group(1))));
        }
        m.appendTail(sb);
        return sb.toString().replace('\u00A0', ' ').replaceAll("\\s+", " ").trim();
    }

    private static String decode(String entity) {
        try {
            if (entity.startsWith("#x") || entity.startsWith("#X")) {
                return String.valueOf((char) Integer.parseInt(entity.substring(2), 16));
            }
            if (entity.startsWith("#")) {
                return String.valueOf((char) Integer.parseInt(entity.substring(1)));
            }
        } catch (Exception ignored) {
            return "&" + entity + ";";
        }
        if ("amp".equals(entity)) return "&";
        if ("lt".equals(entity)) return "<";
        if ("gt".equals(entity)) return ">";
        if ("quot".equals(entity)) return "\"";
        if ("apos".equals(entity)) return "'";
        if ("nbsp".equals(entity)) return " ";
        return "&" + entity + ";";
    }
}
