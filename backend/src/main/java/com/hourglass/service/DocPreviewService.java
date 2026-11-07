package com.hourglass.service;

import com.hourglass.common.AppException;
import fr.opensagres.poi.xwpf.converter.xhtml.XHTMLConverter;
import fr.opensagres.poi.xwpf.converter.xhtml.XHTMLOptions;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 附件 doc / docx 在线预览：docx 用 xdocreport 转 XHTML（保留标题/表格/列表样式），
 * doc（二进制格式）用 POI WordExtractor 提取段落文本，统一包成 HTML 文档给前端 iframe 渲染。
 * md / txt / xlsx 不走这里：前端分别用 marked 与 Univer 直接渲染。
 */
@Service
public class DocPreviewService {

    private static final Logger log = LoggerFactory.getLogger(DocPreviewService.class);

    public Map<String, String> preview(File file, String ext) {
        if ("docx".equals(ext)) {
            return result("html", docxToHtml(file));
        }
        if ("doc".equals(ext)) {
            return result("html", docToHtml(file));
        }
        throw AppException.badRequest("该格式不支持在线预览：" + ext);
    }

    private Map<String, String> result(String type, String html) {
        Map<String, String> m = new LinkedHashMap<String, String>();
        m.put("type", type);
        m.put("content", html);
        return m;
    }

    private String docxToHtml(File file) {
        try (InputStream in = new FileInputStream(file);
             XWPFDocument doc = new XWPFDocument(in)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            XHTMLConverter.getInstance().convert(doc, out, XHTMLOptions.create());
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            /* 部分工具导出的精简 docx 缺 styles 等部件，XHTML 转换会失败；降级为纯文本提取 */
            log.warn("docx XHTML 转换失败，降级文本预览：{}", file.getName(), e);
            return docxTextToHtml(file);
        }
    }

    private String docxTextToHtml(File file) {
        try (InputStream in = new FileInputStream(file);
             XWPFDocument doc = new XWPFDocument(in);
             XWPFWordExtractor extractor = new XWPFWordExtractor(doc)) {
            String[] paras = extractor.getText().split("\n");
            StringBuilder sb = new StringBuilder();
            sb.append("<html><head><meta charset=\"utf-8\"></head><body>");
            for (String p : paras) {
                String t = clean(p);
                sb.append(t.isEmpty() ? "<p>&nbsp;</p>" : "<p>" + esc(t) + "</p>");
            }
            sb.append("</body></html>");
            return sb.toString();
        } catch (Exception e) {
            log.warn("docx 预览转换失败：{}", file.getName(), e);
            throw AppException.badRequest("该 docx 文件无法预览（可能不是有效的 Word 文档）");
        }
    }

    private String docToHtml(File file) {
        try (InputStream in = new FileInputStream(file);
             HWPFDocument doc = new HWPFDocument(in);
             WordExtractor extractor = new WordExtractor(doc)) {
            String[] paras = extractor.getParagraphText();
            StringBuilder sb = new StringBuilder();
            sb.append("<html><head><meta charset=\"utf-8\"></head><body>");
            for (String p : paras) {
                String t = clean(p);
                if (t.isEmpty()) {
                    sb.append("<p>&nbsp;</p>");
                } else {
                    sb.append("<p>").append(esc(t)).append("</p>");
                }
            }
            sb.append("</body></html>");
            return sb.toString();
        } catch (Exception e) {
            log.warn("doc 预览转换失败：{}", file.getName(), e);
            throw AppException.badRequest("该 doc 文件无法预览（可能不是有效的 Word 文档）");
        }
    }

    /** 去掉 Word 段落里的控制字符（段落标记等），只留可展示文本 */
    private String clean(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\r' || c == '\n' || c == '\t' || c == 11 || c == 12) {
                continue;
            }
            if (c < 32 || (c >= 127 && c < 160)) {
                continue;
            }
            sb.append(c);
        }
        return sb.toString().trim();
    }

    private String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
