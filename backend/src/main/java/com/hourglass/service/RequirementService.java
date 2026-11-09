package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.TaskCalc;
import com.hourglass.common.Texts;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.ReqSaveRequest;
import com.hourglass.dto.RequirementDeleteResult;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkActivity;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class RequirementService {

    private final RequirementMapper reqMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final ActivityService activityService;
    private final WorkActivityService workActivityService;
    /** 项目删除时连带清理它下面的需求 */
    private final RequirementDocService docService;
    private final ProjectVersionService versionService;
    private final com.hourglass.mapper.ProjectVersionMapper versionMapper;
    private final com.hourglass.mapper.DemandMapper demandMapper;
    private final DevBranchMapper branchMapper;
    private final ProjectAccessService projectAccess;
    private final AttachmentService attachmentService;
    private final com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper;
    private final TestCaseService caseService;
    private final ProjectTemplateService templateService;
    private final com.hourglass.mapper.WorkspaceMemberMapper memberMapper;
    /** 新建项目时预置默认模块（模块清单挂在项目下） */
    private final CategoryService categoryService;
    @org.springframework.beans.factory.annotation.Autowired
    private TaskQueryService taskQueries;

    public RequirementService(RequirementMapper reqMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                              ActivityService activityService, WorkActivityService workActivityService,
                              RequirementDocService docService, ProjectVersionService versionService,
                              com.hourglass.mapper.ProjectVersionMapper versionMapper,
                              com.hourglass.mapper.DemandMapper demandMapper,
                              DevBranchMapper branchMapper,
                              ProjectAccessService projectAccess,
                              AttachmentService attachmentService,
                              com.hourglass.mapper.MailDeliveryMapper mailDeliveryMapper,
                              TestCaseService caseService,
                              ProjectTemplateService templateService,
                              com.hourglass.mapper.WorkspaceMemberMapper memberMapper,
                              CategoryService categoryService) {
        this.reqMapper = reqMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.activityService = activityService;
        this.workActivityService = workActivityService;
        this.docService = docService;
        this.versionService = versionService;
        this.versionMapper = versionMapper;
        this.demandMapper = demandMapper;
        this.branchMapper = branchMapper;
        this.projectAccess = projectAccess;
        this.attachmentService = attachmentService;
        this.mailDeliveryMapper = mailDeliveryMapper;
        this.caseService = caseService;
        this.templateService = templateService;
        this.memberMapper = memberMapper;
        this.categoryService = categoryService;
    }

    public List<ReqProgress> list(String workspaceId, String userId) {
        List<ReqProgress> out = new ArrayList<ReqProgress>();
        int offset = 0;
        while (true) {
            PageResult<ReqProgress> page = page(workspaceId, userId, offset, 100);
            out.addAll(page.getItems());
            if (!page.isHasMore() || page.getItems().isEmpty()) {
                return out;
            }
            offset += page.getItems().size();
        }
    }

    public PageResult<ReqProgress> page(String workspaceId, String userId, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        int total = reqMapper.countVisible(workspaceId, viewerId);
        /* 只读态一次算清：查看者与非成员全局只读，成员仅在显式 read 的项目上只读 */
        String role = projectAccess.roleOf(workspaceId, userId);
        boolean globalRead = role == null || ProjectAccessService.isViewer(role);
        java.util.Map<String, String> grants = globalRead
                ? java.util.Collections.<String, String>emptyMap()
                : projectAccess.userGrants(workspaceId, userId);
        /* 一次 GROUP BY 汇总各项目，避免为整页进度加载全部任务 */
        java.util.Map<String, com.hourglass.dto.ReqTaskAggRow> aggByReq =
                new java.util.HashMap<String, com.hourglass.dto.ReqTaskAggRow>();
        for (com.hourglass.dto.ReqTaskAggRow a : taskMapper.countByReq(workspaceId)) {
            if (a.getReqId() != null) {
                aggByReq.put(a.getReqId(), a);
            }
        }
        java.util.Map<String, Integer> docCounts = docService.countByReqMap(workspaceId);
        /* 版本数供删除确认框提示：一次 GROUP BY 汇总，避免逐项目查询 */
        java.util.Map<String, Integer> versionCounts = new java.util.HashMap<String, Integer>();
        for (java.util.Map<String, Object> row : versionMapper.countGroupByReq(workspaceId)) {
            Object k = row.get("reqId");
            Object v = row.get("cnt");
            if (k != null && v instanceof Number) {
                versionCounts.put(String.valueOf(k), ((Number) v).intValue());
            }
        }
        java.util.Map<String, Integer> demandCounts = new java.util.HashMap<String, Integer>();
        for (java.util.Map<String, Object> row : demandMapper.countGroupByReq(workspaceId)) {
            Object k = row.get("reqId");
            Object v = row.get("cnt");
            if (k != null && v instanceof Number) {
                demandCounts.put(String.valueOf(k), ((Number) v).intValue());
            }
        }
        List<Requirement> reqs = total <= safeOffset ? new ArrayList<Requirement>()
                : reqMapper.selectPage(workspaceId, viewerId, safeOffset, safeLimit);
        java.util.Map<String, String> ownerNames = new java.util.HashMap<String, String>();
        for (com.hourglass.entity.WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
            if (m.getUserId() != null && m.getDisplayName() != null) {
                ownerNames.put(m.getUserId(), m.getDisplayName());
            }
        }
        List<ReqProgress> out = new ArrayList<ReqProgress>();
        for (Requirement r : reqs) {
            ReqProgress p = new ReqProgress();
            p.setId(r.getId());
            p.setName(r.getName());
            p.setDescription(r.getDescription());
            p.setObjective(r.getObjective());
            p.setStatus(r.getStatus());
            p.setOwnerUserId(r.getOwnerUserId());
            p.setOwnerName(ownerNames.get(r.getOwnerUserId()));
            p.setPlannedStart(r.getPlannedStart());
            p.setPlannedEnd(r.getPlannedEnd());
            p.setArchivedAt(r.getArchivedAt());
            p.setFirstReleasedAt(r.getFirstReleasedAt());
            p.setCreatedAt(r.getCreatedAt());
            p.setUpdatedAt(r.getUpdatedAt());
            p.setAccess(!globalRead && !ProjectAccessService.ACCESS_READ.equals(grants.get(r.getId()))
                    ? "write" : "read");

            com.hourglass.dto.ReqTaskAggRow agg = aggByReq.get(r.getId());
            int count = agg == null ? 0 : agg.getTotal();
            p.setTaskCount(count);
            p.setDoneCount(agg == null ? 0 : agg.getDone());
            Integer dc = docCounts.get(r.getId());
            p.setDocCount(dc == null ? 0 : dc);
            Integer vc = versionCounts.get(r.getId());
            p.setVersionCount(vc == null ? 0 : vc);
            Integer dmc = demandCounts.get(r.getId());
            p.setDemandCount(dmc == null ? 0 : dmc);
            p.setProgressPct(count == 0 ? 0 : (int) Math.round((double) agg.getProgressSum() / count));
            out.add(p);
        }
        return PageResult.of(out, total, safeOffset, safeLimit);
    }

    @Transactional
    public Requirement create(String workspaceId, String userId, ReqSaveRequest req) {
        projectAccess.assertWrite(workspaceId, userId, null);
        String id = Ids.sanitize(Texts.trimToNull(req.getId()));
        if (id == null) {
            id = Ids.gen("R");
        } else if (reqMapper.selectById(id) != null) {
            /* ID 主键全局唯一，可能被其它空间占用：不提示“已存在”，避免跨空间探测 */
            throw new AppException(409, "该ID已被占用，请更换或留空由系统生成：" + id);
        }
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(workspaceId);
        r.setName(req.getName().trim());
        r.setDescription(Texts.trimToNull(req.getDescription()));
        r.setStatus(req.getStatus() == null ? "active" : req.getStatus());
        applyProfile(workspaceId, r, req);
        reqMapper.insert(r);
        /* 项目自带模块清单：预置「其他」，保证一开始就能按模块归类工作项 */
        categoryService.createDefault(workspaceId, r.getId());
        /* 模板只做增量补齐：列按空间共享、文档/测试模块/版本归属本项目 */
        String template = Texts.trimToNull(req.getTemplate());
        if (template != null && templateService.exists(template)) {
            templateService.apply(workspaceId, userId, id, template);
        }
        workActivityService.recordCurrent(workspaceId, WorkActivityService.PROJECT, id,
                "create", "创建了项目「" + r.getName() + "」");
        return reqMapper.selectById(id);
    }

    @Transactional
    public Requirement update(String workspaceId, String userId, String id, ReqSaveRequest req) {
        Requirement old = reqMapper.selectById(id);
        if (old == null || !workspaceId.equals(old.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        projectAccess.assertWrite(workspaceId, userId, id);
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(workspaceId);
        r.setName(req.getName().trim());
        r.setDescription(Texts.trimToNull(req.getDescription()));
        r.setStatus(req.getStatus() == null ? "active" : req.getStatus());
        applyProfile(workspaceId, r, req);
        reqMapper.update(r);
        recordChange(workspaceId, id, "名称", old.getName(), r.getName());
        recordChange(workspaceId, id, "描述", old.getDescription(), r.getDescription());
        recordChange(workspaceId, id, "状态", old.getStatus(), r.getStatus());
        recordChange(workspaceId, id, "项目目标", old.getObjective(), r.getObjective());
        recordChange(workspaceId, id, "负责人", ownerLabel(workspaceId, old.getOwnerUserId()), ownerLabel(workspaceId, r.getOwnerUserId()));
        recordChange(workspaceId, id, "计划开始", old.getPlannedStart(), r.getPlannedStart());
        recordChange(workspaceId, id, "计划结束", old.getPlannedEnd(), r.getPlannedEnd());
        return reqMapper.selectById(id);
    }

    private void applyProfile(String workspaceId, Requirement r, ReqSaveRequest req) {
        r.setObjective(Texts.trimToNull(req.getObjective()));
        String ownerId = Texts.trimToNull(req.getOwnerUserId());
        if (ownerId != null && memberMapper.selectMember(workspaceId, ownerId) == null) {
            throw new AppException(400, "项目负责人不是当前空间成员");
        }
        if (req.getPlannedStart() != null && req.getPlannedEnd() != null
                && req.getPlannedEnd().isBefore(req.getPlannedStart())) {
            throw new AppException(400, "计划结束日不能早于计划开始日");
        }
        r.setOwnerUserId(ownerId);
        r.setPlannedStart(req.getPlannedStart());
        r.setPlannedEnd(req.getPlannedEnd());
    }

    private String ownerLabel(String workspaceId, String userId) {
        if (userId == null) {
            return null;
        }
        com.hourglass.entity.WorkspaceMember m = memberMapper.selectMember(workspaceId, userId);
        return m != null && m.getDisplayName() != null ? m.getDisplayName() : userId;
    }

    /** 归档/取消归档：只影响默认视图展示，不删除数据 */
    @Transactional
    public Requirement setArchived(String workspaceId, String userId, String id, boolean archived) {
        Requirement old = reqMapper.selectById(id);
        if (old == null || !workspaceId.equals(old.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        projectAccess.assertWrite(workspaceId, userId, id);
        reqMapper.setArchived(workspaceId, id, archived);
        workActivityService.recordCurrent(workspaceId, WorkActivityService.PROJECT, id, "archive",
                archived ? "归档了项目" : "取消归档");
        return reqMapper.selectById(id);
    }

    /** 项目活动查询前必须验证项目归属，避免凭实体 ID 跨空间读取。 */
    public PageResult<WorkActivity> activities(String workspaceId, String userId, String id,
                                               int offset, int limit) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        projectAccess.assertView(workspaceId, userId, id);
        return workActivityService.listByEntity(workspaceId, WorkActivityService.PROJECT, id, offset, limit);
    }

    public PageResult<Task> tasks(String workspaceId, String userId, String id, int offset, int limit) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        projectAccess.assertView(workspaceId, userId, id);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = taskMapper.countActiveByReq(workspaceId, id);
        List<Task> items = total <= safeOffset ? new ArrayList<Task>()
                : taskMapper.selectByReqPage(workspaceId, id, safeOffset, safeLimit);
        taskQueries.mergeTaskExtras(workspaceId, items);
        return PageResult.of(items, total, safeOffset, safeLimit);
    }

    /**
     * 标记首版上线日（T0.2）：阶段归组的口径锚点。
     * 只写 first_released_at，不重算任何历史数据；重复标记等于调整口径。
     */
    @Transactional
    public Requirement markFirstRelease(String workspaceId, String id, java.time.LocalDate date) {
        Requirement old = reqMapper.selectById(id);
        if (old == null || !workspaceId.equals(old.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        reqMapper.markFirstReleased(workspaceId, id, date);
        workActivityService.recordCurrent(workspaceId, WorkActivityService.PROJECT, id,
                "first_release", "首版上线日期：" + display(old.getFirstReleasedAt()) + " → " + display(date));
        return reqMapper.selectById(id);
    }

    private void recordChange(String workspaceId, String id, String field, Object oldValue, Object newValue) {
        if (!java.util.Objects.equals(oldValue, newValue)) {
            workActivityService.recordCurrent(workspaceId, WorkActivityService.PROJECT, id, "update",
                    field + "：" + display(oldValue) + " → " + display(newValue));
        }
    }

    private static String display(Object value) {
        return value == null ? "（空）" : String.valueOf(value);
    }

    /**
     * 删除影响预览（A5）：不落库，只统计"删掉这个项目会发生什么"。
     * 与 delete() 的统计口径一致（任务含回收站；分支退回空间级、数量单独给出供提示）。
     */
    public RequirementDeleteResult deleteImpact(String workspaceId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        RequirementDeleteResult result = new RequirementDeleteResult();
        result.setName(r.getName());
        result.setUnlinked(taskMapper.countTasksByReq(workspaceId, id));
        result.setDocs(docService.countByReq(workspaceId, id));
        result.setVersions(versionMapper.selectByReq(workspaceId, id).size());
        result.setDemands(demandMapper.selectByReq(workspaceId, id).size());
        result.setCases(caseService.countByReq(workspaceId, id));
        return result;
    }

    /** @return 解绑任务数 + 连带删除的需求文档数 */
    @Transactional
    public RequirementDeleteResult delete(String userId, String workspaceId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        versionService.assertProjectDeletable(workspaceId, id);
        int docs = docService.countByReq(workspaceId, id);
        /* 版本与需求池强归属项目，删除时一并清理：数量先统计，供确认提示与审计说明 */
        int versions = versionMapper.selectByReq(workspaceId, id).size();
        java.util.List<com.hourglass.entity.Demand> demandList = demandMapper.selectByReq(workspaceId, id);
        int demands = demandList.size();
        /* 需求池条目随项目删除，其附件和待发邮件也必须一起清 */
        java.util.List<String> demandIds = new java.util.ArrayList<String>();
        for (com.hourglass.entity.Demand d : demandList) {
            demandIds.add(d.getId());
            attachmentService.deleteByTarget(workspaceId, d.getId(), AttachmentService.KIND_DEMAND);
        }
        if (!demandIds.isEmpty()) {
            mailDeliveryMapper.deleteByReferenceIds(demandIds);
        }
        /* 统计口径含回收站任务（与 clearReq 解绑范围一致）；时间线用一条 INSERT ... SELECT
           批量补，避免把空间全量任务捞进内存逐条插 */
        int unlinked = taskMapper.countTasksByReq(workspaceId, id);
        /* 模块按项目配置，随项目一并清理；任务模块引用先清空（须在 clearReq 置空 req_id 之前按项目定位） */
        categoryService.purgeProject(workspaceId, id);
        logMapper.insertUnlinkReqLogs(workspaceId, id, userId,
                "解除与已删除项目「" + r.getName() + "」的关联");
        taskMapper.clearReq(workspaceId, id);
        /* 直接归属该项目的分支退回空间级公共分支（分支本身保留） */
        branchMapper.clearReqIdByReq(workspaceId, id);
        /* 项目没了，它下面的需求也是孤儿，一起清掉（需求强归属项目）；同时解绑任务的 req_doc_id */
        docService.deleteByReq(workspaceId, id);
        /* 测试用例同样强归属项目：用例与执行流水一并清理 */
        int cases = caseService.deleteByReq(workspaceId, id);
        /* 版本与绑定关系、需求池条目与流转日志同样强归属项目，一并清理 */
        versionService.deleteByReq(workspaceId, id);
        demandMapper.deleteLogsByReq(workspaceId, id);
        demandMapper.deleteByReq(workspaceId, id);
        projectAccess.clearProject(workspaceId, id);
        workActivityService.deleteByEntity(workspaceId, WorkActivityService.PROJECT, id);
        reqMapper.deleteById(id);
        /* O-9：破坏性配置变更留审计（活动流可见） */
        activityService.logConfig(workspaceId,
                "删除项目「" + r.getName() + "」，解除关联 " + unlinked + " 项任务" +
                        (docs > 0 ? "，连带删除 " + docs + " 份文档" : "") +
                        (versions > 0 ? "，" + versions + " 个版本" : "") +
                        (demands > 0 ? "，" + demands + " 条需求池记录" : "") +
                        (cases > 0 ? "，" + cases + " 条测试用例" : ""));
        RequirementDeleteResult result = new RequirementDeleteResult();
        result.setUnlinked(unlinked);
        result.setDocs(docs);
        result.setVersions(versions);
        result.setDemands(demands);
        result.setCases(cases);
        return result;
    }
}
