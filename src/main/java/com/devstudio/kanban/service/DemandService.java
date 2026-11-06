package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.DemandActionRequest;
import com.devstudio.kanban.dto.DemandSaveRequest;
import com.devstudio.kanban.entity.Demand;
import com.devstudio.kanban.entity.ProjectVersion;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * M2 需求池（T2.1 / T2.4 / T2.5）：CRUD + 状态机 + WSJF。
 *
 * <p>状态机：review（待评审）→ pass（已通过）/ rej（已拒绝）；pass → plan（已排期，选目标版本）；
 * rej → reopen 回 review。评审流转仅空间主可执行，全部动作写 demand_log 留痕。
 * WSJF =（业务价值+时间紧迫度+风险降低）÷ 工作量，四分量齐全才算，禁止手填结果。
 */
@Service
public class DemandService {

    private final DemandMapper demandMapper;
    private final RequirementMapper reqMapper;
    private final ProjectVersionMapper versionMapper;
    private final TaskMapper taskMapper;
    private final NotificationEventService notificationEvents;
    private final RequirementDocMapper docMapper;
    private final ProjectAccessService projectAccess;
    private final AttachmentService attachmentService;
    private final com.devstudio.kanban.mapper.MailDeliveryMapper mailDeliveryMapper;

    public DemandService(DemandMapper demandMapper, RequirementMapper reqMapper,
                         ProjectVersionMapper versionMapper, TaskMapper taskMapper,
                         NotificationEventService notificationEvents, RequirementDocMapper docMapper,
                         ProjectAccessService projectAccess, AttachmentService attachmentService,
                         com.devstudio.kanban.mapper.MailDeliveryMapper mailDeliveryMapper) {
        this.demandMapper = demandMapper;
        this.reqMapper = reqMapper;
        this.versionMapper = versionMapper;
        this.taskMapper = taskMapper;
        this.notificationEvents = notificationEvents;
        this.docMapper = docMapper;
        this.projectAccess = projectAccess;
        this.attachmentService = attachmentService;
        this.mailDeliveryMapper = mailDeliveryMapper;
    }

    public List<Demand> list(String workspaceId, String reqId) {
        return list(workspaceId, reqId, null);
    }

    public List<Demand> list(String workspaceId, String reqId, String userId) {
        List<Demand> list;
        if (reqId == null || reqId.trim().isEmpty()) {
            list = demandMapper.selectByWorkspace(workspaceId);
            java.util.Set<String> hiddenReqs = projectAccess.hiddenProjectIds(workspaceId, userId);
            if (!hiddenReqs.isEmpty()) {
                java.util.List<Demand> visible = new java.util.ArrayList<Demand>();
                for (Demand d : list) {
                    if (d.getReqId() == null || !hiddenReqs.contains(d.getReqId())) {
                        visible.add(d);
                    }
                }
                list = visible;
            }
        } else {
            requireProject(workspaceId, reqId);
            projectAccess.assertView(workspaceId, userId, reqId);
            list = demandMapper.selectByReq(workspaceId, reqId);
        }
        for (Demand d : list) {
            fillWsjf(d);
        }
        return list;
    }

    public Demand get(String workspaceId, String id) {
        Demand d = requireDemand(workspaceId, id);
        fillWsjf(d);
        return d;
    }

    /** 读取前校验项目可见范围（不可见按不存在处理） */
    public Demand getVisible(String workspaceId, String userId, String id) {
        Demand d = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        return d;
    }

    public List<Map<String, Object>> logs(String workspaceId, String id) {
        requireDemand(workspaceId, id);
        return demandMapper.selectLogs(workspaceId, id);
    }

    public List<Map<String, Object>> logs(String workspaceId, String userId, String id) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        return demandMapper.selectLogs(workspaceId, id);
    }

    /** T2.3：需求详情「关联任务」透视（task.demand_id 反查，未完成的排前面） */
    public List<Task> tasks(String workspaceId, String id) {
        requireDemand(workspaceId, id);
        return taskMapper.selectByDemand(workspaceId, id);
    }

    public List<Task> tasks(String workspaceId, String userId, String id) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        return taskMapper.selectByDemand(workspaceId, id);
    }

    @Transactional
    public Demand create(String userId, String workspaceId, DemandSaveRequest req) {
        requireProject(workspaceId, reqIdOf(req));
        projectAccess.assertWrite(workspaceId, userId, reqIdOf(req));
        Demand d = new Demand();
        d.setId(Ids.gen("D"));
        d.setWorkspaceId(workspaceId);
        d.setReqId(reqIdOf(req));
        applyFields(d, req);
        d.setStatus("review");
        d.setCreatedBy(userId);
        demandMapper.insert(d);
        demandMapper.insertLog(workspaceId, d.getId(), "create", null, userId);
        return get(workspaceId, d.getId());
    }

    /** 仅待评审状态可编辑（进入流转后以评审结论为准；被拒需求 reopen 后可再改） */
    @Transactional
    public Demand update(String userId, String workspaceId, String id, DemandSaveRequest req) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        if (!"review".equals(d.getStatus())) {
            throw AppException.badRequest("需求已进入流转（" + statusName(d.getStatus()) + "），不能直接编辑");
        }
        projectAccess.assertWrite(workspaceId, userId, reqIdOf(req));
        applyFields(d, req);
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "update", null, userId);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被编辑",
                "需求内容有更新（仍处于待评审）", d.getId());
        return get(workspaceId, id);
    }

    @Transactional
    public Demand pass(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "review", "pass");
        d.setStatus("pass");
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "pass", d.getReviewNote(), userId);
        notifyStatus(d, userId, "评审通过", d.getReviewNote());
        return get(workspaceId, id);
    }

    @Transactional
    public Demand reject(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "review", "rej");
        String note = Texts.trimToNull(noteOf(body));
        if (note == null) {
            throw AppException.badRequest("请填写拒绝原因");
        }
        d.setStatus("rej");
        d.setReviewNote(Texts.cut(note, 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "rej", d.getReviewNote(), userId);
        notifyStatus(d, userId, "评审拒绝", d.getReviewNote());
        return get(workspaceId, id);
    }

    /** 排期：已通过 → 已排期，必须选同项目的目标版本（T2.4 需求→版本联动） */
    @Transactional
    public Demand plan(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "pass", "plan");
        String versionId = Texts.trimToNull(body == null ? null : body.getVersionId());
        if (versionId == null) {
            throw AppException.badRequest("请选择目标版本");
        }
        ProjectVersion v = versionMapper.selectById(versionId);
        if (v == null || !workspaceId.equals(v.getWorkspaceId()) || !d.getReqId().equals(v.getReqId())) {
            throw AppException.badRequest("目标版本不存在或不属于该需求所在项目：" + versionId);
        }
        d.setStatus("plan");
        d.setVersionId(versionId);
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        if (body != null && body.getExpectDate() != null) {
            d.setExpectDate(body.getExpectDate());
        }
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "plan", "排入版本 " + v.getName()
                + (d.getReviewNote() == null ? "" : "：" + d.getReviewNote()), userId);
        notifyStatus(d, userId, "已排期", "目标版本：" + v.getName()
                + (d.getReviewNote() == null ? "" : "；" + d.getReviewNote()));
        return get(workspaceId, id);
    }

    /** 重新打开：已拒绝 → 待评审（清掉拒绝原因，重新进入评审） */
    @Transactional
    public Demand reopen(String userId, String workspaceId, String id, DemandActionRequest body) {
        Demand d = requireDemand(workspaceId, id);
        requireStatus(d, "rej", "reopen");
        d.setStatus("review");
        d.setReviewNote(Texts.cut(Texts.trimToNull(noteOf(body)), 500));
        demandMapper.update(d);
        demandMapper.insertLog(workspaceId, id, "reopen", d.getReviewNote(), userId);
        notifyStatus(d, userId, "重新打开", d.getReviewNote());
        return get(workspaceId, id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Demand d = requireDemand(workspaceId, id);
        attachmentService.deleteByTarget(workspaceId, id, AttachmentService.KIND_DEMAND);
        mailDeliveryMapper.deleteByReferenceIds(java.util.Collections.singletonList(id));
        docMapper.deleteDemandLinksByDemand(workspaceId, id);
        /* 需求没了，任务上的 demand_id 必须一起解绑，否则编辑任务会被"关联需求不存在"拦住 */
        taskMapper.clearDemandRef(workspaceId, id);
        /* 条目本身要删，留着它自己的流转日志只会变成查不到主人的孤儿行 */
        demandMapper.deleteLogsByDemand(workspaceId, id);
        demandMapper.deleteById(workspaceId, id);
        notifyCreator(d, userId, "需求「" + d.getTitle() + "」已被删除",
                "需求已从需求池删除，关联任务已解绑", null);
    }

    /* ------------------------------------------------------------------ */

    /** 创建时必须挂在一个项目下（需求池按项目归属） */
    private String reqIdOf(DemandSaveRequest req) {
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        return reqId;
    }

    private void applyFields(Demand d, DemandSaveRequest req) {
        d.setTitle(req.getTitle().trim());
        d.setDescription(Texts.trimToNull(req.getDescription()));
        d.setSource(Texts.trimToNull(req.getSource()));
        d.setItemKind(req.getItemKind() == null ? "新功能" : req.getItemKind());
        d.setPriority(req.getPriority() == null ? "P2" : req.getPriority());
        d.setExpectDate(req.getExpectDate());
        d.setAcceptText(Texts.trimToNull(req.getAcceptText()));
        d.setWsjfBusiness(req.getWsjfBusiness());
        d.setWsjfUrgency(req.getWsjfUrgency());
        d.setWsjfRisk(req.getWsjfRisk());
        d.setWsjfEffort(req.getWsjfEffort());
    }

    private Requirement requireProject(String workspaceId, String reqId) {
        Requirement req = reqMapper.selectById(reqId);
        if (req == null || !workspaceId.equals(req.getWorkspaceId())) {
            throw AppException.notFound("项目不存在：" + reqId);
        }
        return req;
    }

    private Demand requireDemand(String workspaceId, String id) {
        Demand d = demandMapper.selectById(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        return d;
    }

    private void requireStatus(Demand d, String expected, String action) {
        if (!expected.equals(d.getStatus())) {
            throw AppException.badRequest("只有「" + statusName(expected) + "」的需求可以"
                    + actionName(action) + "，当前状态：" + statusName(d.getStatus()));
        }
    }

    private String noteOf(DemandActionRequest body) {
        return body == null ? null : body.getNote();
    }

    private void notifyStatus(Demand d, String actorId, String action, String detail) {
        if (d.getCreatedBy() == null || d.getCreatedBy().equals(actorId)) {
            return;
        }
        notificationEvents.notify(d.getCreatedBy(), d.getWorkspaceId(),
                UserNotificationPreferenceService.DEMAND_STATUS,
                "需求「" + d.getTitle() + "」" + action,
                detail == null ? "需求状态已变更为：" + action : Texts.cut(detail, 400), d.getId(), d.getReqId());
    }

    /** 编辑/删除：提交人不是操作者时告知，避免自己的需求被改动却毫不知情 */
    private void notifyCreator(Demand d, String actorId, String title, String body, String referenceId) {
        if (d.getCreatedBy() == null || d.getCreatedBy().equals(actorId)) {
            return;
        }
        notificationEvents.notify(d.getCreatedBy(), d.getWorkspaceId(),
                UserNotificationPreferenceService.DEMAND_STATUS, title, body, referenceId, d.getReqId());
    }

    private void fillWsjf(Demand d) {
        if (d.getWsjfBusiness() != null && d.getWsjfUrgency() != null
                && d.getWsjfRisk() != null && d.getWsjfEffort() != null && d.getWsjfEffort() > 0) {
            d.setWsjfScore(Math.round((d.getWsjfBusiness() + d.getWsjfUrgency() + d.getWsjfRisk())
                    * 10f / d.getWsjfEffort()) / 10d);
        }
    }

    private String statusName(String status) {
        if ("review".equals(status)) {
            return "待评审";
        }
        if ("pass".equals(status)) {
            return "已通过";
        }
        if ("plan".equals(status)) {
            return "已排期";
        }
        if ("rej".equals(status)) {
            return "已拒绝";
        }
        return status;
    }

    private String actionName(String action) {
        if ("pass".equals(action)) {
            return "通过";
        }
        if ("rej".equals(action)) {
            return "拒绝";
        }
        if ("plan".equals(action)) {
            return "排期";
        }
        if ("reopen".equals(action)) {
            return "重新打开";
        }
        return action;
    }
}
