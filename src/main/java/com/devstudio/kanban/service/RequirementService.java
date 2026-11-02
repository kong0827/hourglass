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
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
public class RequirementService {

    private final RequirementMapper reqMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final ActivityService activityService;
    /** 项目删除时连带清理它下面的需求 */
    private final RequirementDocService docService;

    public RequirementService(RequirementMapper reqMapper, TaskMapper taskMapper, TaskLogMapper logMapper,
                              ActivityService activityService, RequirementDocService docService) {
        this.reqMapper = reqMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.activityService = activityService;
        this.docService = docService;
    }

    public List<ReqProgress> list(String workspaceId) {
        /* 一次 GROUP BY 汇总各项目，避免为整页进度加载全部任务 */
        java.util.Map<String, com.devstudio.kanban.dto.ReqTaskAggRow> aggByReq =
                new java.util.HashMap<String, com.devstudio.kanban.dto.ReqTaskAggRow>();
        for (com.devstudio.kanban.dto.ReqTaskAggRow a : taskMapper.countByReq(workspaceId)) {
            if (a.getReqId() != null) {
                aggByReq.put(a.getReqId(), a);
            }
        }
        java.util.Map<String, Integer> docCounts = docService.countByReqMap(workspaceId);
        List<ReqProgress> out = new ArrayList<ReqProgress>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            ReqProgress p = new ReqProgress();
            p.setId(r.getId());
            p.setName(r.getName());
            p.setDescription(r.getDescription());
            p.setStatus(r.getStatus());
            p.setManagerUserId(r.getManagerUserId());
            p.setStartDate(r.getStartDate());
            p.setDueDate(r.getDueDate());
            p.setPriority(r.getPriority());

            com.devstudio.kanban.dto.ReqTaskAggRow agg = aggByReq.get(r.getId());
            int count = agg == null ? 0 : agg.getTotal();
            p.setTaskCount(count);
            p.setDoneCount(agg == null ? 0 : agg.getDone());
            Integer dc = docCounts.get(r.getId());
            p.setDocCount(dc == null ? 0 : dc);
            p.setProgressPct(count == 0 ? 0 : (int) Math.round((double) agg.getProgressSum() / count));
            out.add(p);
        }
        return out;
    }

    @Transactional
    public Requirement create(String userId, String workspaceId, ReqSaveRequest req) {
        String id = Ids.sanitize(Texts.trimToNull(req.getId()));
        if (id == null) {
            id = Ids.gen("R");
        } else if (reqMapper.selectById(id) != null) {
            throw new AppException(409, "项目ID已存在，请检查导入数据");
        }
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(workspaceId);
        r.setName(req.getName().trim());
        r.setDescription(Texts.trimToNull(req.getDescription()));
        r.setStatus(req.getStatus() == null ? "active" : req.getStatus());
        r.setCreatedBy(userId);
        reqMapper.insert(r);
        return reqMapper.selectById(id);
    }

    @Transactional
    public Requirement update(String userId, String myRole, String workspaceId, String id, ReqSaveRequest req) {
        Requirement old = reqMapper.selectById(id);
        if (old == null || !workspaceId.equals(old.getWorkspaceId())) {
            throw AppException.notFound("项目不存在或已被移除");
        }
        String nextStatus = req.getStatus() == null ? "active" : req.getStatus();
        /* PRD 2.2：项目状态只允许空间主或该项目负责人修改，名称/描述维持成员可改 */
        if (!nextStatus.equals(old.getStatus())
                && !"owner".equals(myRole)
                && !(userId != null && userId.equals(old.getManagerUserId()))) {
            throw new AppException(403, "仅空间主或项目负责人可修改项目状态");
        }
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(workspaceId);
        r.setName(req.getName().trim());
        r.setDescription(Texts.trimToNull(req.getDescription()));
        r.setStatus(nextStatus);
        reqMapper.update(r);
        /* done 项目不再参与风险；进入/离开 done 都清掉人工覆盖，避免重新打开时旧覆盖“复活” */
        boolean doneTransition = !nextStatus.equals(old.getStatus())
                && ("done".equals(nextStatus) || "done".equals(old.getStatus()));
        if (doneTransition
                && (old.getHealthOverride() != null || old.getHealthOverrideUntil() != null
                    || old.getHealthNote() != null)) {
            Requirement health = new Requirement();
            health.setId(id);
            health.setWorkspaceId(workspaceId);
            health.setHealthOverride(null);
            health.setHealthNote(null);
            health.setHealthUpdatedBy(userId);
            health.setHealthUpdatedAt(LocalDateTime.now());
            health.setHealthOverrideUntil(null);
            reqMapper.updateHealth(health);
        }
        return reqMapper.selectById(id);
    }

    /** @return 解绑任务数 + 连带删除的需求文档数 */
    @Transactional
    public RequirementDeleteResult delete(String userId, String workspaceId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在或已被移除");
        }
        int docs = docService.countByReq(workspaceId, id);
        int unlinked = 0;
        for (Task t : taskMapper.selectAll(workspaceId)) {
            if (id.equals(t.getReqId())) {
                unlinked++;
                TaskLog taskLog = new TaskLog();
                taskLog.setTaskId(t.getId());
                taskLog.setWorkspaceId(workspaceId);
                taskLog.setActorId(userId);
                taskLog.setAction("update");
                taskLog.setDetail("解除与已删除项目「" + r.getName() + "」的关联");
                logMapper.insert(taskLog);
            }
        }
        taskMapper.clearReq(workspaceId, id);
        /* 项目没了，它下面的需求也是孤儿，一起清掉（需求强归属项目）；同时解绑任务的 req_doc_id */
        docService.deleteByReq(workspaceId, id);
        reqMapper.deleteById(id);
        /* O-9：破坏性配置变更留审计（活动流可见） */
        activityService.logConfig(workspaceId,
                "删除项目「" + r.getName() + "」，解除关联 " + unlinked + " 项任务" +
                        (docs > 0 ? "，连带删除 " + docs + " 份需求文档" : ""));
        RequirementDeleteResult result = new RequirementDeleteResult();
        result.setUnlinked(unlinked);
        result.setDocs(docs);
        return result;
    }
}
