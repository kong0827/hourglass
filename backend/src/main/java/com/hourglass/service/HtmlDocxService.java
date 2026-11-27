package com.hourglass.service;

import org.apache.poi.util.Units;
import org.apache.poi.xwpf.usermodel.ParagraphAlignment;
import org.apache.poi.xwpf.usermodel.UnderlinePatterns;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFStyle;
import org.apache.poi.xwpf.usermodel.XWPFStyles;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTBorder;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTPBdr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTPPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTPPrGeneral;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTShd;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTStyle;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblBorders;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STShd;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STStyleType;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;

/**
 * 把文档正文 HTML 导出为真实 .docx（不是改扩展名的 HTML）。
 * HTML 里以 base64 内联的图片会重新写入 Word 的 media 部件，Word 打开即可看到；
 * 这也是不用「HTML 存成 .doc」的原因：微软明确 Word 不解析 HTML 中的 base64 图片。
 * 只覆盖编辑器能产生的标签（标题/段落/列表/表格/图片/代码块），未知标签按行内文本降级。
 */
@Service
public class HtmlDocxService {

    private static final int MAX_IMAGES = 200;
    private static final int MAX_IMG_WIDTH_PX = 600;
    private static final int MAX_IMG_HEIGHT_PX = 800;
    private static final String BODY_FONT = "微软雅黑";
    private static final String CODE_FONT = "Consolas";

    public byte[] toDocx(String html) {
        org.jsoup.nodes.Document doc = Jsoup.parseBodyFragment(html == null ? "" : html);
        doc.outputSettings().prettyPrint(false);
        try (XWPFDocument out = new XWPFDocument(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            headingStyles(out.createStyles());
            Ctx ctx = new Ctx();
            Sink sink = new Sink(out, null);
            for (Node n : doc.body().childNodes()) {
                block(sink, n, 0, ctx);
            }
            if (out.getBodyElements().isEmpty()) {
                out.createParagraph().createRun().setText("");
            }
            out.write(bytes);
            return bytes.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("Word 导出失败", e);
        }
    }

    /**
     * 正文块落点：文档正文或表格单元格。POI 5 的 IBody 没有创建方法，
     * 单元格只能用 CTTc 直接追加 p / tbl 再包成 XWPF 对象。
     */
    private static final class Sink {
        private final XWPFDocument doc;
        private final XWPFTableCell cell;

        Sink(XWPFDocument doc, XWPFTableCell cell) {
            this.doc = doc;
            this.cell = cell;
        }

        XWPFParagraph paragraph() {
            if (doc != null) {
                return doc.createParagraph();
            }
            return new XWPFParagraph(cell.getCTTc().addNewP(), cell);
        }

        XWPFTable table(int rows, int cols) {
            if (doc != null) {
                return doc.createTable(rows, cols);
            }
            return new XWPFTable(cell.getCTTc().addNewTbl(), cell, rows, cols);
        }
    }

    /** 行内格式继承链：strong/em/span 的样式向子节点传递 */
    private static final class Ctx {
        boolean bold, italic, underline, strike, code, link;
        String color;
        /** 全篇共用的图片计数，拷贝上下文时共享同一个数组 */
        int[] images = new int[]{0};

        Ctx copy() {
            Ctx c = new Ctx();
            c.bold = bold;
            c.italic = italic;
            c.underline = underline;
            c.strike = strike;
            c.code = code;
            c.link = link;
            c.color = color;
            c.images = images;
            return c;
        }
    }

    private void block(Sink body, Node node, int depth, Ctx ctx) {
        if (node instanceof TextNode) {
            String text = ((TextNode) node).getWholeText();
            if (text != null && !text.trim().isEmpty()) {
                paragraph(body).createRun().setText(text.trim());
            }
            return;
        }
        if (!(node instanceof Element)) {
            return;
        }
        Element el = (Element) node;
        String tag = el.tagName().toLowerCase(Locale.ROOT);
        if ("p".equals(tag) && el.hasClass("UniverHeading")) {
            int level = univerHeadingLevel(el.attr("aria-level"));
            if (level > 0) {
                heading(body, el, level, ctx);
                return;
            }
        }
        if ("h1".equals(tag) || "h2".equals(tag) || "h3".equals(tag)
                || "h4".equals(tag) || "h5".equals(tag) || "h6".equals(tag)) {
            heading(body, el, tag.charAt(1) - '0', ctx);
            return;
        }
        if ("ul".equals(tag) || "ol".equals(tag)) {
            list(body, el, "ol".equals(tag), depth + 1, ctx);
            return;
        }
        if ("table".equals(tag)) {
            table(body, el, depth, ctx);
            return;
        }
        if ("blockquote".equals(tag)) {
            quote(body, el, depth, ctx);
            return;
        }
        if ("pre".equals(tag)) {
            codeBlock(body, el, ctx);
            return;
        }
        if ("hr".equals(tag)) {
            rule(body);
            return;
        }
        if ("img".equals(tag)) {
            XWPFParagraph p = paragraph(body);
            image(p.createRun(), el, ctx);
            return;
        }
        if ("br".equals(tag)) {
            paragraph(body).createRun().addBreak();
            return;
        }
        if (isBlockContainer(tag)) {
            boolean hasBlock = false;
            for (Node child : el.childNodes()) {
                if (child instanceof Element && isBlockTag(((Element) child).tagName())) {
                    hasBlock = true;
                    break;
                }
            }
            if (!hasBlock) {
                XWPFParagraph p = paragraph(body);
                applyAlign(p, el);
                inline(el, p, ctx);
                return;
            }
            for (Node child : el.childNodes()) {
                block(body, child, depth, ctx);
            }
            return;
        }
        /* 行内标签单独处在块级位置时补一个段落 */
        XWPFParagraph p = paragraph(body);
        inline(el, p, ctx);
    }

    private boolean isBlockContainer(String tag) {
        return "div".equals(tag) || "section".equals(tag) || "article".equals(tag)
                || "header".equals(tag) || "footer".equals(tag) || "figure".equals(tag)
                || "figcaption".equals(tag) || "p".equals(tag) || "center".equals(tag);
    }

    private boolean isBlockTag(String tag) {
        String t = tag == null ? "" : tag.toLowerCase(Locale.ROOT);
        return "div".equals(t) || "p".equals(t) || "ul".equals(t) || "ol".equals(t)
                || "table".equals(t) || "blockquote".equals(t) || "pre".equals(t)
                || "hr".equals(t) || "h1".equals(t) || "h2".equals(t) || "h3".equals(t)
                || "h4".equals(t) || "h5".equals(t) || "h6".equals(t)
                || "section".equals(t) || "article".equals(t);
    }

    private XWPFParagraph paragraph(Sink body) {
        XWPFParagraph p = body.paragraph();
        p.setSpacingAfter(80);
        return p;
    }

    private void heading(Sink body, Element el, int level, Ctx ctx) {
        XWPFParagraph p = paragraph(body);
        p.setSpacingBefore(200);
        p.setSpacingAfter(100);
        applyAlign(p, el);
        /* 写入内置标题样式 + 大纲级别：Word 导航窗格与「引用-目录」都按它取层级 */
        p.setStyle("Heading" + level);
        CTPPr ppr = p.getCTP().isSetPPr() ? p.getCTP().getPPr() : p.getCTP().addNewPPr();
        if (ppr.isSetOutlineLvl()) {
            ppr.getOutlineLvl().setVal(BigInteger.valueOf(level - 1));
        } else {
            ppr.addNewOutlineLvl().setVal(BigInteger.valueOf(level - 1));
        }
        Ctx c = ctx.copy();
        c.bold = true;
        int halfPoints = level == 1 ? 32 : level == 2 ? 28 : level == 3 ? 24 : level == 4 ? 22 : 20;
        inline(el, p, c, halfPoints);
    }

    /** 导出文档需要自己的 styles.xml：定义 Heading1-6，Word 才能把它们识别成大纲标题 */
    private void headingStyles(XWPFStyles styles) {
        for (int level = 1; level <= 6; level++) {
            CTStyle style = CTStyle.Factory.newInstance();
            style.setStyleId("Heading" + level);
            style.setType(STStyleType.PARAGRAPH);
            style.addNewName().setVal("heading " + level);
            style.addNewQFormat();
            CTPPrGeneral ppr = style.addNewPPr();
            ppr.addNewOutlineLvl().setVal(BigInteger.valueOf(level - 1));
            styles.addStyle(new XWPFStyle(style));
        }
    }

    /** Univer 导出的标题是 p.UniverHeading + aria-level，没有 hN 标签 */
    private int univerHeadingLevel(String ariaLevel) {
        String v = ariaLevel == null ? "" : ariaLevel.trim();
        return v.matches("[1-6]") ? Integer.parseInt(v) : 0;
    }

    private void quote(Sink body, Element el, int depth, Ctx ctx) {
        boolean hasBlock = false;
        for (Node child : el.childNodes()) {
            if (child instanceof Element && isBlockTag(((Element) child).tagName())) {
                hasBlock = true;
                break;
            }
        }
        if (hasBlock) {
            for (Node child : el.childNodes()) {
                block(body, child, depth, ctx);
            }
            return;
        }
        XWPFParagraph p = paragraph(body);
        p.setIndentationLeft(360);
        Ctx c = ctx.copy();
        c.color = "646A73";
        inline(el, p, c);
    }

    private void list(Sink body, Element listEl, boolean ordered, int depth, Ctx ctx) {
        int index = 0;
        for (Element li : listEl.children()) {
            if (!"li".equalsIgnoreCase(li.tagName())) {
                continue;
            }
            index++;
            boolean hasBlock = false;
            for (Node child : li.childNodes()) {
                if (child instanceof Element && isBlockTag(((Element) child).tagName())) {
                    hasBlock = true;
                    break;
                }
            }
            String marker = ordered ? (index + ". ") : "• ";
            XWPFParagraph p = paragraph(body);
            p.setIndentationLeft(360 * depth + 360);
            p.setIndentationHanging(360);
            p.createRun().setText(marker);
            if (hasBlock) {
                /* 列表项里嵌了子列表：本行文字照常带项目符号，子块再按块级缩进 */
                Element inlineOnly = li.clone();
                for (Element child : inlineOnly.children()) {
                    if (isBlockTag(child.tagName())) {
                        child.remove();
                    }
                }
                inline(inlineOnly, p, ctx);
                boolean wrote = !inlineOnly.text().trim().isEmpty();
                for (Node child : li.childNodes()) {
                    if (!(child instanceof Element)) {
                        continue;
                    }
                    Element ce = (Element) child;
                    String ct = ce.tagName().toLowerCase(Locale.ROOT);
                    if ("ul".equals(ct) || "ol".equals(ct) || "table".equals(ct)
                            || "blockquote".equals(ct) || "pre".equals(ct) || "hr".equals(ct)) {
                        block(body, ce, depth, ctx);
                        continue;
                    }
                    /* Univer 列表项的正文包在 <p> 里：并入同一行，避免项目符号单独成段 */
                    if (wrote) {
                        p.createRun().setText(" ");
                    }
                    inline(ce, p, ctx);
                    wrote = true;
                }
                continue;
            }
            inline(li, p, ctx);
        }
    }

    private void codeBlock(Sink body, Element pre, Ctx ctx) {
        String text = pre.wholeText();
        String[] lines = text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        for (String line : lines) {
            XWPFParagraph p = paragraph(body);
            p.setIndentationLeft(240);
            p.setSpacingAfter(0);
            CTShd shd = shading(p);
            shd.setVal(STShd.CLEAR);
            shd.setFill("F6F8FA");
            XWPFRun run = p.createRun();
            run.setFontFamily(CODE_FONT);
            run.setFontSize(19);
            run.setColor("24292F");
            run.setText(line.isEmpty() ? " " : line);
        }
    }

    private void rule(Sink body) {
        XWPFParagraph p = body.paragraph();
        p.setSpacingBefore(120);
        p.setSpacingAfter(120);
        CTPPr ppr = p.getCTP().isSetPPr() ? p.getCTP().getPPr() : p.getCTP().addNewPPr();
        CTPBdr bdr = ppr.isSetPBdr() ? ppr.getPBdr() : ppr.addNewPBdr();
        CTBorder bottom = bdr.isSetBottom() ? bdr.getBottom() : bdr.addNewBottom();
        bottom.setVal(STBorder.SINGLE);
        bottom.setSz(BigInteger.valueOf(6));
        bottom.setColor("DCDFE6");
    }

    private CTShd shading(XWPFParagraph p) {
        CTPPr ppr = p.getCTP().isSetPPr() ? p.getCTP().getPPr() : p.getCTP().addNewPPr();
        return ppr.isSetShd() ? ppr.getShd() : ppr.addNewShd();
    }

    private void table(Sink body, Element tblEl, int depth, Ctx ctx) {
        List<Element> rows = new ArrayList<Element>();
        for (Element child : tblEl.children()) {
            String t = child.tagName().toLowerCase(Locale.ROOT);
            if ("tr".equals(t)) {
                rows.add(child);
            } else if ("thead".equals(t) || "tbody".equals(t) || "tfoot".equals(t)) {
                for (Element tr : child.children()) {
                    if ("tr".equalsIgnoreCase(tr.tagName())) {
                        rows.add(tr);
                    }
                }
            }
        }
        if (rows.isEmpty()) {
            return;
        }
        int cols = 1;
        for (Element tr : rows) {
            int n = 0;
            for (Element cell : tr.children()) {
                String t = cell.tagName().toLowerCase(Locale.ROOT);
                if ("td".equals(t) || "th".equals(t)) {
                    n += Math.max(1, intAttr(cell, "colspan"));
                }
            }
            cols = Math.max(cols, n);
        }
        int rowCount = rows.size();
        XWPFTable table = body.table(rowCount, cols);
        table.setWidth(9000);
        borders(table);
        for (int r = 0; r < rowCount; r++) {
            Element tr = rows.get(r);
            XWPFTableRow row = table.getRow(r);
            int c = 0;
            for (Element cellEl : tr.children()) {
                String t = cellEl.tagName().toLowerCase(Locale.ROOT);
                if (!"td".equals(t) && !"th".equals(t)) {
                    continue;
                }
                if (c >= cols) {
                    break;
                }
                XWPFTableCell cell = row.getCell(c);
                fillCell(cell, cellEl, depth, ctx, "th".equals(t));
                c += Math.max(1, intAttr(cellEl, "colspan"));
            }
        }
        /* 表格后留一个空段，避免与后续正文粘连 */
        paragraph(body);
    }

    private void fillCell(XWPFTableCell cell, Element cellEl, int depth, Ctx ctx, boolean header) {
        boolean empty = cell.getParagraphs().isEmpty();
        if (!empty) {
            cell.removeParagraph(0);
        }
        Ctx c = ctx.copy();
        if (header) {
            c.bold = true;
        }
        boolean hasBlock = false;
        for (Node child : cellEl.childNodes()) {
            if (child instanceof Element && isBlockTag(((Element) child).tagName())) {
                hasBlock = true;
                break;
            }
        }
        if (hasBlock) {
            for (Node child : cellEl.childNodes()) {
                block(new Sink(null, cell), child, depth, c);
            }
        } else {
            XWPFParagraph p = cell.addParagraph();
            p.setSpacingAfter(0);
            inline(cellEl, p, c);
        }
        if (cell.getParagraphs().isEmpty()) {
            cell.addParagraph();
        }
    }

    private void borders(XWPFTable table) {
        CTTblPr pr = table.getCTTbl().getTblPr();
        if (pr == null) {
            pr = table.getCTTbl().addNewTblPr();
        }
        CTTblBorders b = pr.isSetTblBorders() ? pr.getTblBorders() : pr.addNewTblBorders();
        setBorder(b.isSetTop() ? b.getTop() : b.addNewTop());
        setBorder(b.isSetLeft() ? b.getLeft() : b.addNewLeft());
        setBorder(b.isSetBottom() ? b.getBottom() : b.addNewBottom());
        setBorder(b.isSetRight() ? b.getRight() : b.addNewRight());
        setBorder(b.isSetInsideH() ? b.getInsideH() : b.addNewInsideH());
        setBorder(b.isSetInsideV() ? b.getInsideV() : b.addNewInsideV());
    }

    private void setBorder(CTBorder border) {
        border.setVal(STBorder.SINGLE);
        border.setSz(BigInteger.valueOf(4));
        border.setColor("BFBFBF");
    }

    private int intAttr(Element el, String name) {
        try {
            return Math.max(1, Integer.parseInt(el.attr(name).trim()));
        } catch (Exception e) {
            return 1;
        }
    }

    private void inline(Element el, XWPFParagraph p, Ctx ctx) {
        inline(el, p, ctx, 0);
    }

    private void inline(Element el, XWPFParagraph p, Ctx ctx, int baseHalfPoints) {
        for (Node child : el.childNodes()) {
            if (child instanceof TextNode) {
                String text = ((TextNode) child).getWholeText();
                if (text == null || text.isEmpty()) {
                    continue;
                }
                String[] lines = text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
                for (int i = 0; i < lines.length; i++) {
                    if (i > 0) {
                        p.createRun().addBreak();
                    }
                    if (!lines[i].isEmpty()) {
                        run(p, lines[i], ctx, baseHalfPoints);
                    }
                }
                continue;
            }
            if (!(child instanceof Element)) {
                continue;
            }
            Element e = (Element) child;
            String tag = e.tagName().toLowerCase(Locale.ROOT);
            if ("br".equals(tag)) {
                p.createRun().addBreak();
                continue;
            }
            if ("img".equals(tag)) {
                image(p.createRun(), e, ctx);
                continue;
            }
            Ctx c = ctx.copy();
            if ("strong".equals(tag) || "b".equals(tag)) {
                c.bold = true;
            } else if ("em".equals(tag) || "i".equals(tag)) {
                c.italic = true;
            } else if ("u".equals(tag) || "ins".equals(tag)) {
                c.underline = true;
            } else if ("s".equals(tag) || "strike".equals(tag) || "del".equals(tag)) {
                c.strike = true;
            } else if ("code".equals(tag) || "kbd".equals(tag) || "samp".equals(tag)) {
                c.code = true;
            } else if ("a".equals(tag)) {
                c.link = true;
            }
            String color = styleValue(e, "color");
            if (color != null) {
                c.color = color;
            }
            inline(e, p, c, baseHalfPoints);
        }
    }

    private void run(XWPFParagraph p, String text, Ctx ctx, int baseHalfPoints) {
        XWPFRun run = p.createRun();
        run.setText(text);
        if (ctx.bold) {
            run.setBold(true);
        }
        if (ctx.italic) {
            run.setItalic(true);
        }
        if (ctx.underline || ctx.link) {
            run.setUnderline(UnderlinePatterns.SINGLE);
        }
        if (ctx.strike) {
            run.setStrikeThrough(true);
        }
        if (ctx.code) {
            run.setFontFamily(CODE_FONT);
            run.setFontSize(baseHalfPoints > 0 ? baseHalfPoints - 2 : 19);
            if (ctx.color == null) {
                run.setColor("C7254E");
            }
        } else if (baseHalfPoints > 0) {
            run.setFontSize(baseHalfPoints);
        }
        if (ctx.color != null) {
            run.setColor(hex(ctx.color));
        } else if (ctx.link) {
            run.setColor("3370FF");
        }
        if (!ctx.code) {
            try {
                run.setFontFamily(BODY_FONT, XWPFRun.FontCharRange.eastAsia);
            } catch (Exception ignored) {
                /* 老版本 POI 没有 eastAsia 重载；西文仍用默认字体，不影响文字内容 */
            }
        }
    }

    private void applyAlign(XWPFParagraph p, Element el) {
        String align = styleValue(el, "text-align");
        if (align == null) {
            return;
        }
        String v = align.toLowerCase(Locale.ROOT);
        if ("center".equals(v)) {
            p.setAlignment(ParagraphAlignment.CENTER);
        } else if ("right".equals(v)) {
            p.setAlignment(ParagraphAlignment.RIGHT);
        } else if ("justify".equals(v)) {
            p.setAlignment(ParagraphAlignment.BOTH);
        } else if ("left".equals(v)) {
            p.setAlignment(ParagraphAlignment.LEFT);
        }
    }

    private String styleValue(Element el, String prop) {
        String style = el.attr("style");
        if (style == null || style.isEmpty()) {
            return null;
        }
        for (String part : style.split(";")) {
            int i = part.indexOf(':');
            if (i <= 0) {
                continue;
            }
            if (prop.equals(part.substring(0, i).trim().toLowerCase(Locale.ROOT))) {
                String v = part.substring(i + 1).trim();
                return v.isEmpty() ? null : v;
            }
        }
        return null;
    }

    /** rgb(51,112,255) / #3370ff / red 统一成 Word 认的六位十六进制 */
    private String hex(String color) {
        String v = color.trim().toLowerCase(Locale.ROOT);
        if (v.startsWith("#")) {
            String h = v.substring(1);
            if (h.length() == 3) {
                return "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
            }
            return h.length() >= 6 ? h.substring(0, 6) : null;
        }
        if (v.startsWith("rgb")) {
            int l = v.indexOf('(');
            int r = v.indexOf(')');
            if (l > 0 && r > l) {
                String[] nums = v.substring(l + 1, r).split(",");
                if (nums.length >= 3) {
                    try {
                        return String.format("%02x%02x%02x",
                                clamp(Integer.parseInt(nums[0].trim())),
                                clamp(Integer.parseInt(nums[1].trim())),
                                clamp(Integer.parseInt(nums[2].trim())));
                    } catch (Exception ignored) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    private int clamp(int v) {
        return Math.max(0, Math.min(255, v));
    }

    private void image(XWPFRun run, Element img, Ctx ctx) {
        String src = img.attr("src");
        if (src == null || !src.startsWith("data:image/")) {
            /* 外链图片不代服务端抓取（SSRF），按 alt 文本给出可见提示 */
            String alt = img.attr("alt");
            if (alt != null && !alt.isEmpty()) {
                run.setText("[" + alt + "]");
            }
            return;
        }
        if (ctx.images[0] >= MAX_IMAGES) {
            return;
        }
        int comma = src.indexOf(',');
        if (comma < 0) {
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(src.substring(comma + 1));
        } catch (Exception e) {
            return;
        }
        if (bytes.length == 0) {
            return;
        }
        int type = pictureType(src);
        int[] size = imageSize(bytes);
        try {
            run.addPicture(new ByteArrayInputStream(bytes), type, "image" + (++ctx.images[0]) + extOf(src),
                    Units.toEMU(size[0] * 0.75), Units.toEMU(size[1] * 0.75));
        } catch (Exception ignored) {
            /* 单张图片写入失败不阻断整篇导出 */
        }
    }

    private int pictureType(String src) {
        String s = src.toLowerCase(Locale.ROOT);
        if (s.startsWith("data:image/jpeg") || s.startsWith("data:image/jpg")) {
            return XWPFDocument.PICTURE_TYPE_JPEG;
        }
        if (s.startsWith("data:image/gif")) {
            return XWPFDocument.PICTURE_TYPE_GIF;
        }
        if (s.startsWith("data:image/bmp")) {
            return XWPFDocument.PICTURE_TYPE_BMP;
        }
        return XWPFDocument.PICTURE_TYPE_PNG;
    }

    private String extOf(String src) {
        String s = src.toLowerCase(Locale.ROOT);
        if (s.startsWith("data:image/jpeg") || s.startsWith("data:image/jpg")) {
            return ".jpg";
        }
        if (s.startsWith("data:image/gif")) {
            return ".gif";
        }
        if (s.startsWith("data:image/bmp")) {
            return ".bmp";
        }
        if (s.startsWith("data:image/webp")) {
            return ".webp";
        }
        return ".png";
    }

    /** 按原图比例缩到页宽内；读不出尺寸时给一个保守的默认值 */
    private int[] imageSize(byte[] bytes) {
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
            if (img != null && img.getWidth() > 0 && img.getHeight() > 0) {
                double w = img.getWidth();
                double h = img.getHeight();
                double scale = Math.min(1.0, Math.min(MAX_IMG_WIDTH_PX / w, MAX_IMG_HEIGHT_PX / h));
                return new int[]{Math.max(16, (int) Math.round(w * scale)), Math.max(16, (int) Math.round(h * scale))};
            }
        } catch (Exception ignored) {
            /* ImageIO 不支持 webp 等情况走默认尺寸 */
        }
        return new int[]{320, 240};
    }
}
