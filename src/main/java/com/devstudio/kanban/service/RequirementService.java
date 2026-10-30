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
        List<Task> all = taskMapper.selectAll(workspaceId);
        List<ReqProgress> out = new ArrayList<ReqProgress>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            ReqProgress p = new ReqProgress();
            p.setId(r.getId());
            p.setName(r.getName());
            p.setDescription(r.getDescription());
            p.setStatus(r.getStatus());

            int sum = 0;
            int count = 0;
            int done = 0;
            for (Task t : all) {
                if (r.getId().equals(t.getReqId())) {
                    sum += TaskCalc.progressOf(t);
                    count++;
                    if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                        done++;
                    }
                }
            }
            p.setTaskCount(count);
            p.setDoneCount(done);
            p.setDocCount(docService.countByReq(workspaceId, r.getId()));
            p.setProgressPct(count == 0 ? 0 : (int) Math.round((double) sum / count));
            out.add(p);
        }
        return out;
    }

    @Transactional
    public Requirement create(String workspaceId, ReqSaveRequest req) {
        String id = Ids.sanitize(Texts.trimToNull(req.getId()));
        if (id == null) {
            id = Ids.gen("R");
        } else if (reqMapper.selectById(id) != null) {
            throw new AppException(409, "项目ID已存在：" + id);
        }
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(workspaceId);
        r.setName(req.getName().trim());
        r.setDescription(Texts.trimToNull(req.getDescription()));
        r.setStatus(req.getStatus() == null ? "active" : req.getStatus());
        reqMapper.insert(r);
        return reqMapper.selectById(id);
    }

    @Transactional
    public Requirement update(String workspaceId, String id, ReqSaveRequest req) {
        Requirement old = reqMapper.selectById(id);
        if (old == null || !workspaceId.equals(old.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
        }
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(workspaceId);
        r.setName(req.getName().trim());
        r.setDescription(Texts.trimToNull(req.getDescription()));
        r.setStatus(req.getStatus() == null ? "active" : req.getStatus());
        reqMapper.update(r);
        return reqMapper.selectById(id);
    }

    /** @return 解绑任务数 + 连带删除的需求文档数 */
    @Transactional
    public RequirementDeleteResult delete(String userId, String workspaceId, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + id);
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
