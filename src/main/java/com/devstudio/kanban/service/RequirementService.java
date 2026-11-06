package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.TaskCalc;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.ReqProgress;
import com.devstudio.kanban.dto.ReqSaveRequest;
import com.devstudio.kanban.dto.RequirementDeleteResult;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.WorkActivity;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
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
    private final com.devstudio.kanban.mapper.ProjectVersionMapper versionMapper;
    private final com.devstudio.kanban.mapper.DemandMapper demandMapper;
    private final DevBranchMapper branchMapper;
    private final ProjectAccessService projectAccess;
    private final AttachmentService attachmentService;
    private final com.devstudio.kanban.mapper.MailDeliveryMapper mailDeliveryMapper;
    private final TestCaseService caseService;

    public RequirementService(RequirementMapper reqMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                              ActivityService activityService, WorkActivityService workActivityService,
                              RequirementDocService docService, ProjectVersionService versionService,
                              com.devstudio.kanban.mapper.ProjectVersionMapper versionMapper,
                              com.devstudio.kanban.mapper.DemandMapper demandMapper,
                              DevBranchMapper branchMapper,
                              ProjectAccessService projectAccess,
                              AttachmentService attachmentService,
                              com.devstudio.kanban.mapper.MailDeliveryMapper mailDeliveryMapper,
                              TestCaseService caseService) {
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
    }

    public List<ReqProgress> list(String workspaceId, String userId) {
        java.util.Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        /* 只读态一次算清：查看者与非成员全局只读，成员仅在显式 read 的项目上只读 */
        String role = projectAccess.roleOf(workspaceId, userId);
        boolean globalRead = role == null || ProjectAccessService.isViewer(role);
        java.util.Map<String, String> grants = globalRead
                ? java.util.Collections.<String, String>emptyMap()
                : projectAccess.userGrants(workspaceId, userId);
        /* 一次 GROUP BY 汇总各项目，避免为整页进度加载全部任务 */
        java.util.Map<String, com.devstudio.kanban.dto.ReqTaskAggRow> aggByReq =
                new java.util.HashMap<String, com.devstudio.kanban.dto.ReqTaskAggRow>();
        for (com.devstudio.kanban.dto.ReqTaskAggRow a : taskMapper.countByReq(workspaceId)) {
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
        for (com.devstudio.kanban.entity.Demand d : demandMapper.selectByWorkspace(workspaceId)) {
            if (d.getReqId() != null) {
                demandCounts.merge(d.getReqId(), 1, Integer::sum);
            }
        }
        List<Requirement> reqs = reqMapper.selectAll(workspaceId);
        List<ReqProgress> out = new ArrayList<ReqProgress>();
        for (Requirement r : reqs) {
            if (hidden.contains(r.getId())) {
                continue;
            }
            ReqProgress p = new ReqProgress();
            p.setId(r.getId());
            p.setName(r.getName());
            p.setDescription(r.getDescription());
            p.setStatus(r.getStatus());
            p.setFirstReleasedAt(r.getFirstReleasedAt());
            p.setCreatedAt(r.getCreatedAt());
            p.setUpdatedAt(r.getUpdatedAt());
            p.setAccess(!globalRead && !ProjectAccessService.ACCESS_READ.equals(grants.get(r.getId()))
                    ? "write" : "read");

            com.devstudio.kanban.dto.ReqTaskAggRow agg = aggByReq.get(r.getId());
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
        return out;
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
        reqMapper.insert(r);
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
        reqMapper.update(r);
        recordChange(workspaceId, id, "名称", old.getName(), r.getName());
        recordChange(workspaceId, id, "描述", old.getDescription(), r.getDescription());
        recordChange(workspaceId, id, "状态", old.getStatus(), r.getStatus());
        return reqMapper.selectById(id);
    }

    /** 项目活动查询前必须验证项目归属，避免凭实体 ID 跨空间读取。 */
    public List<WorkActivity> activities(String workspaceId, String userId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        projectAccess.assertView(workspaceId, userId, id);
        return workActivityService.listByEntity(workspaceId, WorkActivityService.PROJECT, id);
    }

    public List<Task> tasks(String workspaceId, String userId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        projectAccess.assertView(workspaceId, userId, id);
        return taskMapper.selectByReq(workspaceId, id);
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

    /** @return 解绑任务数 + 连带删除的需求文档数 */
    @Transactional
    public RequirementDeleteResult delete(String userId, String workspaceId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        int docs = docService.countByReq(workspaceId, id);
        /* 版本与需求池强归属项目，删除时一并清理：数量先统计，供确认提示与审计说明 */
        int versions = versionMapper.selectByReq(workspaceId, id).size();
        java.util.List<com.devstudio.kanban.entity.Demand> demandList = demandMapper.selectByReq(workspaceId, id);
        int demands = demandList.size();
        /* 需求池条目随项目删除，其附件和待发邮件也必须一起清 */
        java.util.List<String> demandIds = new java.util.ArrayList<String>();
        for (com.devstudio.kanban.entity.Demand d : demandList) {
            demandIds.add(d.getId());
            attachmentService.deleteByTarget(workspaceId, d.getId(), AttachmentService.KIND_DEMAND);
        }
        if (!demandIds.isEmpty()) {
            mailDeliveryMapper.deleteByReferenceIds(demandIds);
        }
        /* 统计口径含回收站任务（与 clearReq 解绑范围一致）；时间线用一条 INSERT ... SELECT
           批量补，避免把空间全量任务捞进内存逐条插 */
        int unlinked = taskMapper.countTasksByReq(workspaceId, id);
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
        return result;
    }
}
