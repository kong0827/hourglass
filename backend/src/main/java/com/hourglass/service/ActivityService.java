package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.TaskLogMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 空间级活动流（O-9）。
 *
 * 复用 task_log 表：配置类破坏性操作（删列/模块/项目、移出成员、清空数据、导入覆盖）
 * 以固定哨兵 task_id = CFG 落库，因此：
 *   - 会出现在空间活动流里（可按 workspace_id 查询）；
 *   - 永远不会混进任何任务的「操作时间线」（那条查询按真实 task_id 过滤）。
 */
@Service
public class ActivityService {

    private static final Logger log = LoggerFactory.getLogger(ActivityService.class);

    /** 配置类事件的哨兵任务ID（不指向任何真实任务） */
    public static final String CONFIG_TASK_ID = "CFG";

    private final TaskLogMapper logMapper;
    private final ProjectAccessService projectAccess;

    public ActivityService(TaskLogMapper logMapper, ProjectAccessService projectAccess) {
        this.logMapper = logMapper;
        this.projectAccess = projectAccess;
    }

    /** 记录一条配置类变更（失败只记日志，不影响主流程） */
    public void logConfig(String workspaceId, String actorId, String detail) {
        try {
            TaskLog l = new TaskLog();
            l.setTaskId(CONFIG_TASK_ID);
            l.setWorkspaceId(workspaceId);
            l.setActorId(actorId);
            l.setAction("config");
            l.setDetail(Texts.cut(detail, 250));
            logMapper.insert(l);
        } catch (Exception e) {
            // 审计日志失败不应阻断业务操作，但要留痕便于排查
            log.warn("配置审计写入失败（workspace={}）：{}", workspaceId, detail, e);
        }
    }

    /** 便捷重载：自行解析当前登录人（启动期/无请求上下文时留空） */
    public void logConfig(String workspaceId, String detail) {
        String actorId = null;
        try {
            actorId = com.hourglass.common.CurrentUser.id();
        } catch (Exception e) {
            actorId = null;
        }
        logConfig(workspaceId, actorId, detail);
    }

    /** 空间活动流（倒序；配置审计仅空间主与管理员可见） */
    public com.hourglass.dto.PageResult<TaskLog> activity(
            String workspaceId, String userId, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        boolean includeConfig = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        int total = logMapper.countByWorkspace(workspaceId, viewerId, includeConfig);
        List<TaskLog> items = total <= safeOffset ? new java.util.ArrayList<TaskLog>()
                : logMapper.selectByWorkspace(workspaceId, viewerId, includeConfig, safeOffset, safeLimit);
        return com.hourglass.dto.PageResult.of(items, total, safeOffset, safeLimit);
    }
}
