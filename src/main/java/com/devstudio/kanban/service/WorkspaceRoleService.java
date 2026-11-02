package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 空间成员角色变更。
 * owner 不参与变更；只允许 member ↔ exec。exec 是只读管理层，不能同时是项目/任务负责人。
 */
@Service
public class WorkspaceRoleService {

    private final WorkspaceService workspaceService;
    private final WorkspaceMemberMapper memberMapper;
    private final RequirementMapper requirementMapper;
    private final TaskMapper taskMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberCache memberCache;
    private final ActivityService activityService;

    public WorkspaceRoleService(WorkspaceService workspaceService, WorkspaceMemberMapper memberMapper,
                                RequirementMapper requirementMapper, TaskMapper taskMapper, UserMapper userMapper,
                                WorkspaceMemberCache memberCache, ActivityService activityService) {
        this.workspaceService = workspaceService;
        this.memberMapper = memberMapper;
        this.requirementMapper = requirementMapper;
        this.taskMapper = taskMapper;
        this.userMapper = userMapper;
        this.memberCache = memberCache;
        this.activityService = activityService;
    }

    @Transactional
    public void changeRole(String operatorId, String workspaceId, String targetUserId, String newRole) {
        Workspace ws = workspaceService.requireOwner(operatorId, workspaceId);
        if (!"shared".equals(ws.getType())) {
            throw AppException.badRequest("个人空间不能变更成员角色");
        }
        if (!"member".equals(newRole) && !"exec".equals(newRole)) {
            throw AppException.badRequest("角色只能是成员或只读管理层");
        }
        WorkspaceMember target = memberMapper.selectMember(workspaceId, targetUserId);
        if (target == null) {
            throw AppException.notFound("成员不存在或已被移除");
        }
        if ("owner".equals(target.getRole()) || targetUserId.equals(ws.getOwnerId())) {
            throw AppException.badRequest("空间主角色不参与变更");
        }
        if (newRole.equals(target.getRole())) {
            return;
        }
        if ("exec".equals(newRole)) {
            if (requirementMapper.countByManager(workspaceId, targetUserId) > 0) {
                throw new AppException(409, "该成员仍是项目负责人，请先转交项目后再设为只读管理层");
            }
            if (taskMapper.countByOwnerUserId(workspaceId, targetUserId) > 0) {
                throw new AppException(409, "该成员仍是任务负责人，请先转交任务后再设为只读管理层");
            }
        }
        memberMapper.updateRole(workspaceId, targetUserId, newRole);
        AppUser targetUser = userMapper.selectById(targetUserId);
        String targetName = targetUser == null ? null : Texts.trimToNull(targetUser.getDisplayName());
        if (targetName == null && targetUser != null) {
            targetName = Texts.trimToNull(targetUser.getUsername());
        }
        activityService.logConfig(workspaceId, operatorId,
                "变更成员角色：" + (targetName == null ? "该成员" : targetName)
                        + " → " + ("exec".equals(newRole) ? "管理层" : "成员"));
        memberCache.evict(workspaceId, targetUserId);
    }
}
