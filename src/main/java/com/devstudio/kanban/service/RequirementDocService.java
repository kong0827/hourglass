package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.ReqDocSaveRequest;
import com.devstudio.kanban.dto.ReqDocView;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 需求（项目下的需求文档）。
 *
 * <p><b>正文安全</b>：前端是所见即所得编辑器，提交的是 HTML。任何客户端都可能是恶意的，
 * 所以**入库前在服务端做白名单清洗**（jsoup）—— 只留排版标签，去掉脚本、事件属性与危险样式。
 * 表格（SunEditor 原生表格）、图片（粘贴截图的内联 data URL）会保留，但属性逐个白名单。
 * 渲染时前端仍会再清洗一次（双保险，见 app.js 的 sanitizeHTML）。
 */
@Service
public class RequirementDocService {

    /** 正文上限：粘贴截图会以 base64 内联，200KB 会把图片截断，放宽到 12MB（列是 MEDIUMTEXT，上限 16MB） */
    private static final int CONTENT_MAX = 12_000_000;

    /** 摘要长度 */
    private static final int EXCERPT_MAX = 80;

    /**
     * 允许的标签与属性：
     * 段落/标题/列表/引用/代码/链接/分割线 + 表格 + 少量行内格式。
     * 刻意**不允许** script / iframe / 事件属性 / 危险样式 —— 这些带来 XSS 风险。
     * 表格结构放行（SunEditor 原生表格），单元格合并用 colspan / rowspan。
     */
    private static final Safelist SAFELIST = Safelist.relaxed()
            .addTags("h1", "h2", "h3", "h4", "hr", "s", "del", "ins")
            /* 表格：放行结构 + 单元格合并；style 已由 :all 放行，具体属性由 filterStyles 逐个过滤 */
            .addAttributes("td", "colspan", "rowspan")
            .addAttributes("th", "colspan", "rowspan", "scope")
            /* 图片：允许 http(s) 外链与 data URL（粘贴的截图就是 data URL），具体白名单见 filterImages */
            .addAttributes("img", "src", "alt")
            .addProtocols("img", "src", "http", "https", "data")
            /* class 表达对齐/缩进，style 表达颜色，两者都无害、由下面逐个属性过滤 */
            .addAttributes(":all", "class", "style")
            /* Quill 时代的列表用 <li data-list="bullet|ordered">，SunEditor 用标准 ul/ol；
               保留此放行以兼容旧数据 */
            .addAttributes("li", "data-list")
            .addAttributes("a", "href", "title", "target", "rel")
            .addProtocols("a", "href", "http", "https", "mailto");

    /** style 只允许这三个属性（Quill 的颜色 / 背景 / 对齐） */
    private static final java.util.Set<String> STYLE_ALLOW = new java.util.HashSet<String>(
            java.util.Arrays.asList("color", "background-color", "text-align"));

    /** 属性值只允许颜色与对齐这类字面量，挡掉 url(...) / expression(...) */
    private static final java.util.regex.Pattern STYLE_VALUE =
            java.util.regex.Pattern.compile("^[#a-zA-Z0-9(),.%\\s-]{1,60}$");

    private final RequirementDocMapper docMapper;
    private final RequirementMapper reqMapper;
    private final UserMapper userMapper;

    public RequirementDocService(RequirementDocMapper docMapper, RequirementMapper reqMapper, UserMapper userMapper) {
        this.docMapper = docMapper;
        this.reqMapper = reqMapper;
        this.userMapper = userMapper;
    }

    public List<ReqDocView> list(String workspaceId) {
        List<ReqDocView> rows = docMapper.selectViewByWorkspace(workspaceId);
        for (ReqDocView v : rows) {
            v.setExcerpt(excerptOf(v.getContentBrief()));
            v.setContentBrief(null);
        }
        return rows;
    }

    public RequirementDoc get(String workspaceId, String id) {
        RequirementDoc d = docMapper.selectById(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        return d;
    }

    @Transactional
    public RequirementDoc create(String userId, String workspaceId, ReqDocSaveRequest req) {
        String reqId = ensureProject(workspaceId, req.getReqId());
        RequirementDoc d = new RequirementDoc();
        d.setId(Ids.gen("D"));
        d.setWorkspaceId(workspaceId);
        apply(d, reqId, req, userId);
        docMapper.insert(d);
        return docMapper.selectById(d.getId());
    }

    @Transactional
    public RequirementDoc update(String userId, String workspaceId, String id, ReqDocSaveRequest req) {
        RequirementDoc d = get(workspaceId, id);
        String oldReqId = d.getReqId();
        String reqId = ensureProject(workspaceId, req.getReqId());
        apply(d, reqId, req, userId);
        docMapper.update(d);
        /* 需求换项目后，仍挂在旧项目下的任务会指向别的项目的文档：解掉这些关联 */
        if (oldReqId != null && !oldReqId.equals(reqId)) {
            docMapper.clearTaskRefExceptReq(workspaceId, d.getId(), reqId);
        }
        return docMapper.selectById(id);
    }

    /**
     * 删除需求：任务上的关联解绑（任务本身不动），然后删需求。
     * 任务保留原项目，所以不会连带删任务。
     */
    @Transactional
    public void delete(String workspaceId, String id) {
        RequirementDoc d = get(workspaceId, id);
        docMapper.clearTaskRef(workspaceId, d.getId());
        docMapper.delete(d.getId());
    }

    /** 项目被删除时连带清理（由 RequirementService 调用） */
    @Transactional
    public int deleteByReq(String workspaceId, String reqId) {
        /* 需求没了，任务上的 req_doc_id 必须一起解绑；
           只删 requirement_doc 会留下悬空引用，任务详情里看不到但数据已经不一致。 */
        for (String docId : docMapper.selectIdsByReq(workspaceId, reqId)) {
            docMapper.clearTaskRef(workspaceId, docId);
        }
        return docMapper.deleteByReq(workspaceId, reqId);
    }

    /** 某项目下的需求文档数（项目列表展示 / 删除前提示用） */
    public int countByReq(String workspaceId, String reqId) {
        return docMapper.countByReq(workspaceId, reqId);
    }

    /**
     * HTML 白名单清洗。返回 null 表示"清洗后没有实质内容"（空段落之类）。
     */
    public static String sanitize(String html) {
        if (html == null || html.trim().isEmpty()) {
            return null;
        }
        String src = html.length() > CONTENT_MAX ? html.substring(0, CONTENT_MAX) : html;
        Document dirty = Jsoup.parseBodyFragment(src);
        dirty.outputSettings().prettyPrint(false);
        Document clean = new org.jsoup.safety.Cleaner(SAFELIST).clean(dirty);
        clean.outputSettings().prettyPrint(false);
        filterStyles(clean.body());
        filterImages(clean.body());
        String out = clean.body().html();
        if (out == null || out.trim().isEmpty()) {
            return null;
        }
        /* 只有空标签（<p><br></p> 之类）也视为空 */
        String text = clean.body().text();
        return (text == null || text.trim().isEmpty()) && out.indexOf("<hr") < 0 ? null : out;
    }

    /**
     * 只保留色值/对齐相关的 style 属性：编辑器的调色板会写成 inline style，
     * 直接放行整个 style 串风险太大（可塞 position:fixed、background-image:url(...) 之类）。
     */
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
     * 图片白名单：只允许 png/jpeg/gif/webp 的 data URL 或 http(s) 外链，单图 3MB 以内。
     * 刻意排除 svg（可内嵌脚本）与其它 data 类型。
     */
    private static void filterImages(org.jsoup.nodes.Element body) {
        for (org.jsoup.nodes.Element img : body.select("img")) {
            String src = img.attr("src");
            boolean ok = src.startsWith("data:image/png;base64,")
                    || src.startsWith("data:image/jpeg;base64,")
                    || src.startsWith("data:image/jpg;base64,")
                    || src.startsWith("data:image/gif;base64,")
                    || src.startsWith("data:image/webp;base64,")
                    || src.startsWith("http://")
                    || src.startsWith("https://");
            if (!ok || src.length() > 3_000_000) {
                img.remove();
                continue;
            }
            String alt = img.attr("alt");
            img.clearAttributes();
            img.attr("src", src);
            if (!alt.isEmpty()) {
                img.attr("alt", alt);
            }
        }
    }

    private void apply(RequirementDoc d, String reqId, ReqDocSaveRequest req, String userId) {
        d.setReqId(reqId);
        d.setTitle(Texts.cut(Texts.trimToNull(req.getTitle()), 100));
        d.setContent(sanitize(req.getContent()));
        String status = Texts.trimToNull(req.getStatus());
        d.setStatus(status == null ? "draft" : status);
        String owner = Texts.trimToNull(req.getOwner());
        if (owner == null) {
            /* 不填负责人 = 默认当前用户 */
            AppUser me = userMapper.selectById(userId);
            d.setOwner(me == null ? null : Texts.cut(me.getDisplayName(), 32));
            d.setOwnerUserId(userId);
        } else {
            d.setOwner(Texts.cut(owner, 32));
            d.setOwnerUserId(null);
        }
    }

    private String ensureProject(String workspaceId, String reqId) {
        String rid = Texts.trimToNull(reqId);
        if (rid == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        Requirement r = reqMapper.selectById(rid);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.badRequest("所属项目不存在：" + rid);
        }
        return rid;
    }

    /** 从 HTML 片段抽纯文本摘要 */
    private String excerptOf(String html) {
        if (html == null || html.trim().isEmpty()) {
            return null;
        }
        String text = Jsoup.parse(html).text().replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) {
            return null;
        }
        return text.length() <= EXCERPT_MAX ? text : text.substring(0, EXCERPT_MAX) + "…";
    }
}
