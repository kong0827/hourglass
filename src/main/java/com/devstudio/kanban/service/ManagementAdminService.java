package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.BulkProjectMetaRequest;
import com.devstudio.kanban.dto.BulkTaskMetaRequest;
import com.devstudio.kanban.dto.HealthOverrideRequest;
import com.devstudio.kanban.dto.ProjectMetaRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 管理写操作：项目元数据/健康覆盖/批量补全/任务字段批量维护。 */
@Service
public class ManagementAdminService {

    private final RequirementMapper reqMapper;
    private final TaskMapper taskMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final ActivityService activityService;

    public ManagementAdminService(RequirementMapper reqMapper, TaskMapper taskMapper,
                                  WorkspaceMemberMapper memberMapper, UserMapper userMapper,
                                  ActivityService activityService) {
        this.reqMapper = reqMapper;
        this.taskMapper = taskMapper;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.activityService = activityService;
    }

    public void requireShared(Workspace ws) {
        if (ws == null || !"shared".equals(ws.getType())) {
            throw new AppException(403, "管理驾驶舱仅共享空间可用");
        }
    }

    public Requirement updateProjectMeta(String operatorId, Workspace ws, String projectId,
                                         ProjectMetaRequest req) {
        requireShared(ws);
        if ("exec".equals(ws.getMyRole())) {
            throw new AppException(403, "管理层为只读角色，不能修改项目资料");
        }
        Requirement old = requireProject(ws, projectId);
        boolean owner = "owner".equals(ws.getMyRole());
        boolean manager = operatorId.equals(old.getManagerUserId());
        if (!owner && !manager) {
            throw new AppException(403, "仅空间主或项目负责人可维护项目资料");
        }
        String managerUserId = old.getManagerUserId();
        if (owner) {
            /* null=未提交（保持原值）；空字符串=清空负责人 */
            if (req.getManagerUserId() != null) {
                managerUserId = Texts.trimToNull(req.getManagerUserId());
                /* 原负责人已不在空间时允许原样保留（数据质量会提示），但不允许新指派给非成员 */
                if (managerUserId != null && !managerUserId.equals(old.getManagerUserId())) {
                    WorkspaceMember m = memberMapper.selectMember(ws.getId(), managerUserId);
                    if (m == null || (!"owner".equals(m.getRole()) && !"member".equals(m.getRole()))) {
                        throw AppException.badRequest("项目负责人必须是空间主或普通成员，不能是只读管理层");
                    }
                }
            }
        } else {
            /* 项目负责人：只能保持原负责人，不能借 meta 接口改负责人 */
            String requested = Texts.trimToNull(req.getManagerUserId());
            if (requested != null && !java.util.Objects.equals(requested, old.getManagerUserId())) {
                throw new AppException(403, "仅空间主可变更项目负责人");
            }
        }
        if (req.getStartDate() != null && req.getDueDate() != null
                && req.getStartDate().isAfter(req.getDueDate())) {
            throw AppException.badRequest("开始日期不能晚于截止日期");
        }
        String priority = req.getPriority() == null ? (old.getPriority() == null ? "P2" : old.getPriority())
                : req.getPriority();
        if (!"P0".equals(priority) && !"P1".equals(priority)
                && !"P2".equals(priority) && !"P3".equals(priority)) {
            throw AppException.badRequest("项目优先级只能是 P0-P3");
        }
        Requirement patch = new Requirement();
        patch.setId(old.getId());
        patch.setWorkspaceId(ws.getId());
        patch.setManagerUserId(managerUserId);
        patch.setStartDate(req.getStartDate());
        patch.setDueDate(req.getDueDate());
        patch.setPriority(priority);
        reqMapper.updateMeta(patch);
        activityService.logConfig(ws.getId(), operatorId, "维护项目资料：「" + old.getName() + "」");
        return reqMapper.selectById(old.getId());
    }

    public Requirement overrideHealth(String operatorId, Workspace ws, String projectId,
                                      HealthOverrideRequest req) {
        requireShared(ws);
        Requirement old = requireProject(ws, projectId);
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可人工覆盖风险等级");
        }
        String override = Texts.trimToNull(req.getHealthOverride());
        String note = Texts.trimToNull(req.getHealthNote());
        if ("done".equals(old.getStatus()) && override != null) {
            throw AppException.badRequest("已完成项目不参与风险计算，请先重新打开项目再覆盖健康度");
        }
        LocalDateTime until = null;
        if (override != null) {
            if (!"red".equals(override) && !"amber".equals(override) && !"green".equals(override)) {
                throw AppException.badRequest("风险覆盖值只能是 red/amber/green");
            }
            if (note == null || note.codePointCount(0, note.length()) < 5) {
                throw AppException.badRequest("人工覆盖原因至少 5 个字");
            }
            int days = req.getDays() == null ? 30 : Math.max(1, Math.min(365, req.getDays()));
            until = LocalDateTime.now().plusDays(days);
        }
        Requirement patch = new Requirement();
        patch.setId(old.getId());
        patch.setWorkspaceId(ws.getId());
        patch.setHealthOverride(override);
        patch.setHealthNote(override == null ? null : Texts.cut(note, 200));
        patch.setHealthUpdatedBy(operatorId);
        patch.setHealthUpdatedAt(LocalDateTime.now());
        patch.setHealthOverrideUntil(until);
        reqMapper.updateHealth(patch);
        activityService.logConfig(ws.getId(), operatorId,
                override == null ? "恢复项目自动风险：「" + old.getName() + "」"
                        : "调整项目风险覆盖：「" + old.getName() + "」");
        return reqMapper.selectById(old.getId());
    }

    public Map<String, Object> bulkProjectMeta(String operatorId, Workspace ws, BulkProjectMetaRequest req) {
        requireShared(ws);
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可批量补全项目资料");
        }
        int ok = 0;
        List<Map<String, Object>> errors = new ArrayList<Map<String, Object>>();
        if (req != null && req.getItems() != null) {
            for (BulkProjectMetaRequest.Item item : req.getItems()) {
                if (item == null || Texts.trimToNull(item.getId()) == null) continue;
                try {
                    Requirement old = requireProject(ws, item.getId());
                    ProjectMetaRequest one = new ProjectMetaRequest();
                    /* 批量补全按“只改填了的字段”处理，null 表示保持原值 */
                    one.setManagerUserId(item.getManagerUserId() == null
                            ? old.getManagerUserId() : item.getManagerUserId());
                    one.setStartDate(item.getStartDate() == null ? old.getStartDate() : item.getStartDate());
                    one.setDueDate(item.getDueDate() == null ? old.getDueDate() : item.getDueDate());
                    one.setPriority(item.getPriority() == null ? old.getPriority() : item.getPriority());
                    updateProjectMeta(operatorId, ws, item.getId(), one);
                    ok++;
                } catch (AppException e) {
                    Map<String, Object> err = new LinkedHashMap<String, Object>();
                    err.put("id", item.getId());
                    err.put("message", e.getMessage());
                    errors.add(err);
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("updated", ok);
        out.put("failed", errors.size());
        out.put("errors", errors);
        return out;
    }

    public Map<String, Object> bulkTaskMeta(String operatorId, Workspace ws, BulkTaskMetaRequest req) {
        requireShared(ws);
        if (!"owner".equals(ws.getMyRole())) {
            throw new AppException(403, "仅空间主可批量维护任务字段");
        }
        if (req == null || req.getTaskIds() == null || req.getTaskIds().isEmpty()) {
            throw AppException.badRequest("请选择任务");
        }
        String ownerUserId = Texts.trimToNull(req.getOwnerUserId());
        if (ownerUserId == null && req.getDueDate() == null) {
            throw AppException.badRequest("请至少设置负责人或截止日期");
        }
        AppUser owner = null;
        if (ownerUserId != null) {
            WorkspaceMember m = memberMapper.selectMember(ws.getId(), ownerUserId);
            if (m == null || (!"owner".equals(m.getRole()) && !"member".equals(m.getRole()))) {
                throw AppException.badRequest("任务负责人必须是空间主或普通成员，不能是只读管理层");
            }
            owner = userMapper.selectById(ownerUserId);
            if (owner == null) {
                throw AppException.badRequest("负责人账号不存在");
            }
        }
        int ok = 0;
        List<Map<String, Object>> errors = new ArrayList<Map<String, Object>>();
        for (String rawId : req.getTaskIds()) {
            String id = Texts.trimToNull(rawId);
            if (id == null) continue;
            try {
                Task t = taskMapper.selectById(id);
                if (t == null || !ws.getId().equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
                    throw AppException.notFound("任务不存在或已被删除");
                }
                if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                    throw new AppException(409, "已完成任务字段已锁定：" + t.getTitle());
                }
                if (owner != null) {
                    t.setOwnerUserId(ownerUserId);
                    t.setOwner(owner.getDisplayName() == null ? owner.getUsername() : owner.getDisplayName());
                }
                if (req.getDueDate() != null) {
                    if (t.getStartDate() != null && t.getStartDate().isAfter(req.getDueDate())) {
                        throw AppException.badRequest("截止日期不能早于任务开始日期：" + t.getTitle());
                    }
                    t.setDueDate(req.getDueDate());
                }
                taskMapper.update(t);
                activityService.logConfig(ws.getId(), operatorId, "批量维护任务资料：「" + t.getTitle() + "」");
                ok++;
            } catch (AppException e) {
                Map<String, Object> err = new LinkedHashMap<String, Object>();
                err.put("id", id);
                err.put("message", e.getMessage());
                errors.add(err);
            }
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("updated", ok);
        out.put("failed", errors.size());
        out.put("errors", errors);
        return out;
    }

    private Requirement requireProject(Workspace ws, String id) {
        Requirement r = reqMapper.selectById(id);
        if (r == null || !ws.getId().equals(r.getWorkspaceId())) {
            throw AppException.notFound("项目不存在或已被移除");
        }
        return r;
    }
}
