package com.hourglass.service;

import com.hourglass.common.Ids;
import com.hourglass.dto.ColumnRequest;
import com.hourglass.dto.ProjectTemplateView;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.TestModule;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.TestModuleMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * 项目模板：只做增量补齐，不改动空间已有的列、文档与版本。
 * 模板不落配置表，内置在当前类里，保持轻量、可随版本演进。
 */
@Service
public class ProjectTemplateService {

    public static final String BLANK = "blank";
    public static final String STANDARD = "standard";
    public static final String TEST = "test";

    private static final class Def {
        final String code;
        final String name;
        final String description;
        final List<String> columns;
        final List<String> docs;
        final List<String> modules;
        final String versionName;

        Def(String code, String name, String description, List<String> columns,
            List<String> docs, List<String> modules, String versionName) {
            this.code = code;
            this.name = name;
            this.description = description;
            this.columns = columns;
            this.docs = docs;
            this.modules = modules;
            this.versionName = versionName;
        }
    }

    private static final List<Def> DEFS = Collections.unmodifiableList(Arrays.asList(
            new Def(BLANK, "空白项目", "只创建项目本身，后续按需补充",
                    Collections.<String>emptyList(), Collections.<String>emptyList(),
                    Collections.<String>emptyList(), null),
            new Def(STANDARD, "产品研发", "补齐研发协作骨架：联调/验收列、三份文档、默认版本与常用测试模块",
                    Arrays.asList("联调", "待验收"),
                    Arrays.asList("需求文档", "技术方案", "测试验收"),
                    Arrays.asList("核心流程", "异常与边界", "权限与安全"),
                    "V1.0"),
            new Def(TEST, "测试管理", "补齐测试骨架：待复测列、测试方案/缺陷记录、默认版本与测试模块",
                    Collections.singletonList("待复测"),
                    Arrays.asList("测试方案", "缺陷记录"),
                    Arrays.asList("功能", "接口", "性能", "兼容性"),
                    "V1.0")
    ));

    private final BoardColumnService columnService;
    private final RequirementDocService docService;
    private final ProjectVersionService versionService;
    private final ProjectVersionMapper versionMapper;
    private final TestModuleMapper moduleMapper;
    private final com.hourglass.mapper.RequirementDocMapper docMapper;

    public ProjectTemplateService(BoardColumnService columnService, RequirementDocService docService,
                                  ProjectVersionService versionService, ProjectVersionMapper versionMapper,
                                  TestModuleMapper moduleMapper,
                                  com.hourglass.mapper.RequirementDocMapper docMapper) {
        this.columnService = columnService;
        this.docService = docService;
        this.versionService = versionService;
        this.versionMapper = versionMapper;
        this.moduleMapper = moduleMapper;
        this.docMapper = docMapper;
    }

    public List<ProjectTemplateView> list() {
        List<ProjectTemplateView> out = new ArrayList<ProjectTemplateView>();
        for (Def d : DEFS) {
            ProjectTemplateView v = new ProjectTemplateView();
            v.setCode(d.code);
            v.setName(d.name);
            v.setDescription(d.description);
            v.setColumns(new ArrayList<String>(d.columns));
            v.setDocs(new ArrayList<String>(d.docs));
            v.setModules(new ArrayList<String>(d.modules));
            v.setVersionName(d.versionName);
            out.add(v);
        }
        return out;
    }

    public boolean exists(String code) {
        return find(code) != null;
    }

    @Transactional
    public void apply(String workspaceId, String userId, String reqId, String code) {
        Def d = find(code);
        if (d == null || BLANK.equals(d.code)) {
            return;
        }
        applyColumns(workspaceId, d.columns);
        applyDocs(workspaceId, userId, reqId, d);
        applyModules(workspaceId, reqId, d.modules);
        applyVersion(workspaceId, userId, reqId, d.versionName);
    }

    private Def find(String code) {
        if (code == null) {
            return null;
        }
        for (Def d : DEFS) {
            if (d.code.equals(code)) {
                return d;
            }
        }
        return null;
    }

    /* 看板列按空间共享：只补缺失的列，不重命名、不删除已有列 */
    private void applyColumns(String workspaceId, List<String> names) {
        if (names.isEmpty()) {
            return;
        }
        java.util.Set<String> existing = new java.util.HashSet<String>();
        for (BoardColumn c : columnService.list(workspaceId)) {
            existing.add(c.getName());
        }
        for (String name : names) {
            if (existing.contains(name) || "已完成".equals(name)) {
                continue;
            }
            ColumnRequest req = new ColumnRequest();
            req.setName(name);
            columnService.create(workspaceId, req);
            existing.add(name);
        }
    }

    private void applyDocs(String workspaceId, String userId, String reqId, Def d) {
        for (int i = 0; i < d.docs.size(); i++) {
            String title = d.docs.get(i);
            ReqDocSaveRequest req = new ReqDocSaveRequest();
            req.setReqId(reqId);
            req.setTitle(title);
            req.setDocType(docTypeOf(title));
            req.setFormat("markdown");
            req.setContent(skeletonOf(title));
            req.setStatus("draft");
            com.hourglass.entity.RequirementDoc doc = docService.create(userId, workspaceId, req);
            /* 模板文档按定义顺序排列，避免同一秒创建时顺序随机 */
            docMapper.updateSortOrder(workspaceId, doc.getId(), i, null);
        }
    }

    private void applyModules(String workspaceId, String reqId, List<String> names) {
        for (int i = 0; i < names.size(); i++) {
            TestModule m = new TestModule();
            m.setId(Ids.gen("M"));
            m.setWorkspaceId(workspaceId);
            m.setReqId(reqId);
            m.setName(names.get(i));
            m.setSortOrder(i);
            moduleMapper.insert(m);
        }
    }

    private void applyVersion(String workspaceId, String userId, String reqId, String name) {
        if (name == null) {
            return;
        }
        for (ProjectVersion v : versionMapper.selectByReq(workspaceId, reqId)) {
            if (name.equals(v.getName())) {
                return;
            }
        }
        ProjectVersionSaveRequest req = new ProjectVersionSaveRequest();
        req.setReqId(reqId);
        req.setName(name);
        req.setDescription("由项目模板创建，可按实际节奏调整日期");
        req.setStatus("planned");
        versionService.create(userId, workspaceId, req);
    }

    private static String docTypeOf(String title) {
        if (title.indexOf("技术") >= 0) {
            return "technical";
        }
        if (title.indexOf("测试") >= 0 || title.indexOf("验收") >= 0) {
            return "acceptance";
        }
        if (title.indexOf("需求") >= 0) {
            return "requirement";
        }
        return "other";
    }

    private static String skeletonOf(String title) {
        if ("需求文档".equals(title)) {
            return "# 需求文档\n\n## 背景\n\n## 目标\n\n## 用户与场景\n\n## 范围\n\n## 验收标准\n";
        }
        if ("技术方案".equals(title)) {
            return "# 技术方案\n\n## 方案概述\n\n## 关键设计\n\n## 影响范围\n\n## 风险与回滚\n";
        }
        if ("测试验收".equals(title)) {
            return "# 测试验收\n\n## 测试范围\n\n## 关键用例\n\n## 验收清单\n\n## 遗留问题\n";
        }
        if ("测试方案".equals(title)) {
            return "# 测试方案\n\n## 测试范围\n\n## 环境与数据\n\n## 进度安排\n\n## 风险\n";
        }
        if ("缺陷记录".equals(title)) {
            return "# 缺陷记录\n\n> 也可以直接在「测试用例」里执行失败转缺陷，这里记录跨轮次的问题。\n\n## 缺陷清单\n";
        }
        return "# " + title + "\n\n";
    }
}
