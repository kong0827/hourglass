package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.DocTemplateSaveRequest;
import com.hourglass.dto.DocTemplateView;
import com.hourglass.entity.DocTemplate;
import com.hourglass.entity.DocumentType;
import com.hourglass.mapper.DocTemplateMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 文档模板：内置骨架 + 工作区自定义模板。
 * 模板只提供可选骨架，不锁字段；正文仍按文档原有 HTML / Markdown 存储。
 */
@Service
public class DocTemplateService {

    private static final String BUILTIN_PREFIX = "builtin:";
    private static final Map<String, String[]> BUILTINS = new LinkedHashMap<String, String[]>();

    static {
        BUILTINS.put("requirement", new String[]{"需求文档",
                "# 背景与目标\n\n<!-- 为什么做，解决谁的什么问题 -->\n\n"
                        + "# 范围与非目标\n\n- 本期范围：\n- 明确不做：\n\n"
                        + "# 用户故事 / 功能点\n\n1. \n\n"
                        + "# 验收标准\n\n- [ ] \n\n"
                        + "# 风险与依赖\n\n- \n"});
        BUILTINS.put("technical", new String[]{"技术方案",
                "# 现状与问题\n\n\n"
                        + "# 方案概述\n\n\n"
                        + "# 备选方案与取舍\n\n| 方案 | 优点 | 缺点 | 结论 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n"
                        + "# 影响面\n\n- 接口 / 数据：\n- 兼容与迁移：\n\n"
                        + "# 回滚与验证\n\n- \n"});
        BUILTINS.put("acceptance", new String[]{"测试验收",
                "# 验收范围\n\n\n"
                        + "# 环境与数据\n\n\n"
                        + "# 验收用例\n\n| 编号 | 场景 | 预期 | 结果 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n"
                        + "# 遗留问题\n\n- \n"});
        BUILTINS.put("decision", new String[]{"决策记录",
                "# 背景\n\n\n"
                        + "# 选项\n\n1. \n2. \n\n"
                        + "# 决定\n\n\n"
                        + "# 理由与后果\n\n- \n\n"
                        + "# 状态\n\n提议 / 已接受 / 已替代\n"});
        BUILTINS.put("retro", new String[]{"复盘",
                "# 目标与结果\n\n- 目标：\n- 结果：\n\n"
                        + "# 偏差与原因\n\n\n"
                        + "# 做得好的\n\n- \n\n"
                        + "# 待改进\n\n- \n\n"
                        + "# 可复用资产\n\n- \n"});
    }

    private final DocTemplateMapper templateMapper;
    private final ProjectAccessService projectAccess;

    public DocTemplateService(DocTemplateMapper templateMapper, ProjectAccessService projectAccess) {
        this.templateMapper = templateMapper;
        this.projectAccess = projectAccess;
    }

    public List<DocTemplateView> list(String workspaceId, String userId) {
        boolean canManage = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        List<DocTemplateView> out = new ArrayList<DocTemplateView>();
        for (Map.Entry<String, String[]> e : BUILTINS.entrySet()) {
            DocTemplateView v = new DocTemplateView();
            v.setId(BUILTIN_PREFIX + e.getKey());
            v.setName(e.getValue()[0]);
            v.setDocType("decision".equals(e.getKey()) || "retro".equals(e.getKey()) ? "other" : e.getKey());
            v.setFormat("markdown");
            v.setContent(e.getValue()[1]);
            v.setBuiltin(true);
            v.setDeletable(false);
            out.add(v);
        }
        for (DocTemplate t : templateMapper.selectByWorkspace(workspaceId)) {
            DocTemplateView v = new DocTemplateView();
            v.setId(t.getId());
            v.setName(t.getName());
            v.setDocType(t.getDocType());
            v.setFormat(t.getFormat());
            v.setContent(t.getContent());
            v.setBuiltin(false);
            v.setDeletable(canManage);
            out.add(v);
        }
        return out;
    }

    @Transactional
    public DocTemplateView create(String userId, String workspaceId, DocTemplateSaveRequest req) {
        assertManage(workspaceId, userId);
        String name = Texts.trimToNull(req.getName());
        if (name == null) {
            throw AppException.badRequest("请填写模板名称");
        }
        name = Texts.cut(name, 20);
        if (templateMapper.selectByName(workspaceId, name) != null) {
            throw AppException.badRequest("已存在同名模板：" + name);
        }
        String format = "html".equals(req.getFormat()) ? "html" : "markdown";
        DocTemplate t = new DocTemplate();
        t.setId(Ids.gen("DT"));
        t.setWorkspaceId(workspaceId);
        t.setName(name);
        t.setDocType(DocumentType.parseOrOther(req.getDocType()).getCode());
        t.setFormat(format);
        t.setContent(RequirementDocService.contentOf(format, req.getContent()));
        t.setCreatedBy(userId);
        templateMapper.insert(t);
        DocTemplateView v = new DocTemplateView();
        v.setId(t.getId());
        v.setName(t.getName());
        v.setDocType(t.getDocType());
        v.setFormat(t.getFormat());
        v.setContent(t.getContent());
        v.setBuiltin(false);
        v.setDeletable(true);
        return v;
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        assertManage(workspaceId, userId);
        if (id != null && id.startsWith(BUILTIN_PREFIX)) {
            throw AppException.badRequest("内置模板不能删除");
        }
        DocTemplate t = templateMapper.selectById(id);
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            throw AppException.notFound("模板不存在：" + id);
        }
        templateMapper.delete(workspaceId, id);
    }

    private void assertManage(String workspaceId, String userId) {
        if (!ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId))) {
            throw new AppException(403, "只有空间所有者或管理员可以管理文档模板");
        }
    }
}
