package com.hourglass.common;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * HTML 白名单清洗工具。
 *
 * <p>项目内富文本字段（任务描述、需求文档正文等）统一在服务端入库前清洗，
 * 只保留排版/图片等安全标签，去掉脚本、事件属性与危险样式；前端渲染时通常会再清洗一次。
 */
public final class HtmlSanitizer {

    private HtmlSanitizer() {
    }

    /** 任务描述允许的标签：与 SunEditor 工具栏对齐， lighter than 需求文档。 */
    private static final Safelist TASK_DESC_SAFELIST = Safelist.relaxed()
            .removeTags("h1", "h2", "h3", "h4", "h5", "h6", "hr", "blockquote", "pre", "table",
                    "thead", "tbody", "tr", "td", "th", "caption", "col", "colgroup")
            .addTags("s")
            .addAttributes("img", "src", "alt", "width", "height")
            .addAttributes("a", "href", "title", "target", "rel")
            .addAttributes(":all", "class", "style")
            /* 描述图片存站内相对路径（/api/attachments/...），部署前缀由前端渲染时补；
               jsoup 的协议校验不认相对 URL，会把 src 整条去掉，改由 filterImages 白名单把关。 */
            .removeProtocols("img", "src", "http", "https")
            .addProtocols("a", "href", "http", "https", "mailto");

    /** 任务描述内容上限（MEDIUMTEXT 16MB 余量），含 HTML 标签与图片 URL。 */
    private static final int TASK_DESC_MAX = 3_000_000;

    private static final Set<String> STYLE_ALLOW = new HashSet<String>(
            Arrays.asList("color", "background-color", "text-align"));

    private static final Pattern STYLE_VALUE =
            Pattern.compile("^[#a-zA-Z0-9(),.%\\s-]{1,60}$");

    /**
     * 清洗任务描述 HTML。
     *
     * @param html 原始 HTML，null 或清洗后无实质内容返回 null
     * @return 清洗后的 HTML
     */
    public static String taskDescription(String html) {
        if (html == null || html.trim().isEmpty()) {
            return null;
        }
        String src = html.length() > TASK_DESC_MAX ? html.substring(0, TASK_DESC_MAX) : html;
        Document dirty = Jsoup.parseBodyFragment(src);
        dirty.outputSettings().prettyPrint(false);
        Document clean = new org.jsoup.safety.Cleaner(TASK_DESC_SAFELIST).clean(dirty);
        clean.outputSettings().prettyPrint(false);
        filterStyles(clean.body());
        filterImages(clean.body());
        String out = clean.body().html();
        if (out == null || out.trim().isEmpty()) {
            return null;
        }
        String text = clean.body().text();
        boolean hasImage = !clean.body().select("img").isEmpty();
        return (text == null || text.trim().isEmpty()) && !hasImage ? null : out;
    }

    private static void filterStyles(org.jsoup.nodes.Element body) {
        for (org.jsoup.nodes.Element el : body.select("[style]")) {
            StringBuilder sb = new StringBuilder();
            for (String part : el.attr("style").split(";")) {
                int i = part.indexOf(':');
                if (i <= 0) {
                    continue;
                }
                String k = part.substring(0, i).trim().toLowerCase();
                String v = part.substring(i + 1).trim();
                if (!STYLE_ALLOW.contains(k) || !STYLE_VALUE.matcher(v).matches()) {
                    continue;
                }
                if (sb.length() > 0) {
                    sb.append("; ");
                }
                sb.append(k).append(": ").append(v);
            }
            if (sb.length() == 0) {
                el.removeAttr("style");
            } else {
                el.attr("style", sb.toString());
            }
        }
    }

    /**
     * 图片白名单：只允许本地 attachment URL 或 http(s) 外链（方案 B：图片走独立 attachment）。
     * 不允 data URL，避免把大 base64 塞进数据库。
     */
    private static void filterImages(org.jsoup.nodes.Element body) {
        for (org.jsoup.nodes.Element img : body.select("img")) {
            String src = img.attr("src");
            boolean ok = (src.indexOf("/api/attachments/") >= 0
                    || src.startsWith("http://") || src.startsWith("https://"))
                    && src.length() <= 2048;
            if (!ok) {
                img.remove();
                continue;
            }
            String alt = img.attr("alt");
            String width = img.attr("width");
            String height = img.attr("height");
            img.clearAttributes();
            img.attr("src", src);
            if (!alt.isEmpty()) {
                img.attr("alt", alt);
            }
            /* 编辑器里拖拽改过的尺寸存在 width/height（纯数字 px），丢了会缩回原图大小 */
            if (isPx(width)) {
                img.attr("width", width);
            }
            if (isPx(height)) {
                img.attr("height", height);
            }
        }
    }

    private static boolean isPx(String v) {
        return v != null && v.matches("\\d{1,4}");
    }
}
