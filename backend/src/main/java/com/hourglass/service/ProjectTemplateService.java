package com.hourglass.service;

import com.hourglass.dto.CategoryRequest;
import com.hourglass.dto.ColumnRequest;
import com.hourglass.dto.ProjectTemplateView;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.mapper.ProjectVersionMapper;
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
    public static final String OUTSOURCING = "outsourcing";
    public static final String INTERNAL_IT = "internal-it";
    public static final String AGILE = "agile";

    /** 示例工作项：日期相对创建当天偏移，保证样例项目一打开就有进行中的排期 */
    private static final class Sample {
        final String title;
        final String column;
        final String priority;
        final String type;
        final int start;
        final int due;
        final int estimate;

        Sample(String title, String column, String priority, String type, int start, int due, int estimate) {
            this.title = title;
            this.column = column;
            this.priority = priority;
            this.type = type;
            this.start = start;
            this.due = due;
            this.estimate = estimate;
        }
    }

    private static final class Def {
        final String code;
        final String name;
        final String description;
        final List<String> columns;
        final List<String> docs;
        final List<String> modules;
        final String versionName;
        final List<Sample> samples;

        Def(String code, String name, String description, List<String> columns,
            List<String> docs, List<String> modules, String versionName, List<Sample> samples) {
            this.code = code;
            this.name = name;
            this.description = description;
            this.columns = columns;
            this.docs = docs;
            this.modules = modules;
            this.versionName = versionName;
            this.samples = samples;
        }
    }

    /* 三个场景模板各带 12–20 条示例工作项：创建后不用先想内容，
       就能直接走一遍看板 → 版本 → 交付说明的完整链路。 */
    private static List<Sample> outsourcingSamples() {
        return Arrays.asList(
                new Sample("需求澄清与范围确认", "done", "P0", "story", -28, -24, 480),
                new Sample("交付里程碑与排期", "done", "P1", "task", -24, -22, 240),
                new Sample("技术方案评审", "done", "P1", "task", -22, -19, 360),
                new Sample("核心接口联调", "doing", "P0", "story", -12, -2, 960),
                new Sample("数据迁移脚本", "doing", "P0", "task", -10, 1, 720),
                new Sample("权限与角色配置", "doing", "P1", "task", -8, 2, 360),
                new Sample("异常流程处理", "backlog", "P1", "story", 1, 7, 480),
                new Sample("对账报表开发", "backlog", "P2", "story", 2, 10, 720),
                new Sample("性能压测", "test", "P1", "task", -3, 4, 480),
                new Sample("安全基线检查", "test", "P1", "task", -2, 5, 240),
                new Sample("客户验收演示准备", "backlog", "P0", "task", 6, 9, 360),
                new Sample("操作手册编写", "backlog", "P2", "task", 3, 12, 480),
                new Sample("上线部署清单", "backlog", "P1", "task", 8, 10, 180),
                new Sample("回滚预案演练", "backlog", "P1", "task", 8, 10, 180),
                new Sample("验收问题修复", "backlog", "P1", "bug", 11, 14, 480),
                new Sample("交付说明与签收", "backlog", "P0", "task", 13, 14, 120)
        );
    }

    private static List<Sample> internalItSamples() {
        return Arrays.asList(
                new Sample("现状流程调研", "done", "P0", "story", -30, -26, 480),
                new Sample("需求清单与优先级", "done", "P0", "task", -26, -23, 240),
                new Sample("表单字段设计", "done", "P1", "story", -23, -19, 360),
                new Sample("审批流配置", "doing", "P0", "task", -14, -3, 720),
                new Sample("组织与角色同步", "doing", "P0", "task", -12, 0, 480),
                new Sample("历史数据清洗", "doing", "P1", "task", -9, 4, 720),
                new Sample("单点登录接入", "backlog", "P1", "task", 0, 8, 480),
                new Sample("移动端适配", "backlog", "P2", "task", 2, 11, 480),
                new Sample("权限边界测试", "test", "P0", "task", -4, 3, 360),
                new Sample("关键用户培训", "backlog", "P1", "task", 7, 10, 240),
                new Sample("上线公告与答疑", "backlog", "P1", "task", 11, 12, 120),
                new Sample("试运行问题收集", "backlog", "P1", "bug", 12, 18, 480),
                new Sample("流程优化迭代", "backlog", "P2", "story", 19, 26, 720),
                new Sample("运维交接", "backlog", "P1", "task", 24, 26, 240)
        );
    }

    private static List<Sample> agileSamples() {
        return Arrays.asList(
                new Sample("产品愿景与目标用户", "done", "P0", "story", -21, -18, 240),
                new Sample("用户故事地图", "done", "P1", "story", -18, -14, 360),
                new Sample("技术选型与脚手架", "done", "P1", "task", -14, -11, 480),
                new Sample("登录与账号体系", "doing", "P0", "story", -7, 1, 720),
                new Sample("核心页面原型", "doing", "P1", "story", -6, 0, 480),
                new Sample("首个可运行版本", "doing", "P0", "task", -3, 4, 960),
                new Sample("用户反馈收集", "backlog", "P1", "task", 4, 8, 240),
                new Sample("自动化测试补齐", "test", "P1", "task", -2, 5, 480),
                new Sample("性能与体验优化", "backlog", "P2", "task", 6, 11, 480),
                new Sample("灰度发布", "backlog", "P0", "task", 9, 10, 180),
                new Sample("埋点与数据看板", "backlog", "P2", "task", 10, 15, 480),
                new Sample("下一迭代规划", "backlog", "P1", "task", 13, 14, 180)
        );
    }

    private static final List<Def> DEFS = Collections.unmodifiableList(Arrays.asList(
            new Def(BLANK, "空白项目", "只创建项目本身，后续按需补充",
                    Collections.<String>emptyList(), Collections.<String>emptyList(),
                    Collections.<String>emptyList(), null,
                    Collections.<Sample>emptyList()),
            new Def(STANDARD, "产品研发", "补齐研发协作骨架：联调/验收列、三份文档、默认版本与常用测试分类",
                    Arrays.asList("联调", "待验收"),
                    Arrays.asList("需求文档", "技术方案", "测试验收"),
                    Arrays.asList("核心流程", "异常与边界", "权限与安全"),
                    "V1.0", Collections.<Sample>emptyList()),
            new Def(TEST, "测试管理", "补齐测试骨架：待复测列、测试方案/缺陷记录、默认版本与测试分类",
                    Collections.singletonList("待复测"),
                    Arrays.asList("测试方案", "缺陷记录"),
                    Arrays.asList("功能", "接口", "性能", "兼容性"),
                    "V1.0", Collections.<Sample>emptyList()),
            new Def(OUTSOURCING, "外包交付", "16 条示例工作项 + 交付版本与文档骨架，适合按里程碑交付给客户",
                    Arrays.asList("联调", "待验收"),
                    Arrays.asList("需求确认", "技术方案", "交付验收"),
                    Arrays.asList("核心流程", "接口与集成", "验收问题"),
                    "交付 V1.0", outsourcingSamples()),
            new Def(INTERNAL_IT, "内部信息化", "14 条示例工作项 + 上线版本与文档骨架，适合内部系统上线推广",
                    Arrays.asList("待审批", "待培训"),
                    Arrays.asList("调研纪要", "实施方案", "操作手册"),
                    Arrays.asList("审批流程", "权限与组织", "数据迁移"),
                    "上线 V1.0", internalItSamples()),
            new Def(AGILE, "小团队敏捷", "12 条示例工作项 + 迭代版本与文档骨架，适合两周一个小版本的团队",
                    Arrays.asList("待评审", "待复测"),
                    Arrays.asList("产品愿景", "迭代计划", "技术方案"),
                    Arrays.asList("体验", "性能", "稳定性"),
                    "迭代 1", agileSamples())
    ));

    private final BoardColumnService columnService;
    private final RequirementDocService docService;
    private final ProjectVersionService versionService;
    private final ProjectVersionMapper versionMapper;
    private final CategoryService categoryService;
    private final com.hourglass.mapper.RequirementDocMapper docMapper;
    private final TaskCommandService taskService;

    public ProjectTemplateService(BoardColumnService columnService, RequirementDocService docService,
                                  ProjectVersionService versionService, ProjectVersionMapper versionMapper,
                                  CategoryService categoryService,
                                  com.hourglass.mapper.RequirementDocMapper docMapper,
                                  TaskCommandService taskService) {
        this.columnService = columnService;
        this.docService = docService;
        this.versionService = versionService;
        this.versionMapper = versionMapper;
        this.categoryService = categoryService;
        this.docMapper = docMapper;
        this.taskService = taskService;
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
            v.setSampleCount(d.samples.size());
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
        applyModules(workspaceId, userId, reqId, d.modules);
        String versionId = applyVersion(workspaceId, userId, reqId, d);
        applySamples(workspaceId, userId, reqId, versionId, d.samples);
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

    private void applyModules(String workspaceId, String userId, String reqId, List<String> names) {
        for (String name : names) {
            CategoryRequest req = new CategoryRequest();
            req.setName(name);
            categoryService.create(workspaceId, userId, reqId, req);
        }
    }

    private String applyVersion(String workspaceId, String userId, String reqId, Def d) {
        if (d.versionName == null) {
            return null;
        }
        for (ProjectVersion v : versionMapper.selectByReq(workspaceId, reqId)) {
            if (d.versionName.equals(v.getName())) {
                return v.getId();
            }
        }
        ProjectVersionSaveRequest req = new ProjectVersionSaveRequest();
        req.setReqId(reqId);
        req.setName(d.versionName);
        req.setDescription(d.samples.isEmpty()
                ? "由项目模板创建，可按实际节奏调整日期"
                : "模板创建的示例版本，可直接改名或调整日期");
        req.setStatus(d.samples.isEmpty() ? "planned" : "active");
        ProjectVersion created = versionService.create(userId, workspaceId, req);
        return created == null ? null : created.getId();
    }

    /* 示例工作项全部挂在模板版本下：打开交付说明时不用先手工绑版本 */
    private void applySamples(String workspaceId, String userId, String reqId,
                              String versionId, List<Sample> rows) {
        if (rows.isEmpty()) {
            return;
        }
        java.time.LocalDate today = java.time.LocalDate.now();
        for (Sample s : rows) {
            com.hourglass.dto.TaskSaveRequest req = new com.hourglass.dto.TaskSaveRequest();
            req.setReqId(reqId);
            req.setTitle(s.title);
            req.setDescription("示例工作项：可直接改名、调整状态或删除。");
            req.setBoardColumn(s.column);
            req.setPriority(s.priority);
            req.setItemType(s.type);
            if ("bug".equals(s.type)) {
                req.setSeverity("major");
            }
            req.setStartDate(today.plusDays(s.start));
            req.setDueDate(today.plusDays(s.due));
            req.setEstimateMinutes(s.estimate);
            if (versionId != null) {
                req.setVersionIds(Collections.singletonList(versionId));
            }
            taskService.create(userId, workspaceId, req);
        }
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
