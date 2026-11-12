package com.hourglass.service;

import com.hourglass.common.CurrentUser;
import com.hourglass.common.Texts;
import com.hourglass.entity.AuditLog;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.AuditLogMapper;
import com.hourglass.mapper.TaskLogMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** 成员展示标签的强一致留痕：与业务共用事务，不吞写入异常。 */
@Service
public class MemberLabelLogService {
    private final TaskLogMapper activities;
    private final AuditLogMapper audits;

    public MemberLabelLogService(TaskLogMapper activities, AuditLogMapper audits) {
        this.activities = activities;
        this.audits = audits;
    }

    public void record(String workspaceId, String actorId, String action, String targetType,
                       String targetId, String targetName, String detail) {
        TaskLog activity = new TaskLog();
        activity.setTaskId(ActivityService.CONFIG_TASK_ID);
        activity.setWorkspaceId(workspaceId);
        activity.setActorId(actorId);
        activity.setAction("config");
        activity.setDetail(Texts.cut(detail, 250));
        if (activities.insert(activity) != 1) {
            throw new IllegalStateException("Member label activity was not recorded");
        }
        AuditLog audit = new AuditLog();
        audit.setWorkspaceId(workspaceId);
        audit.setActorId(actorId);
        audit.setActorName(actorId);
        try {
            audit.setActorName(Texts.cut(CurrentUser.get().getDisplayName(), 64));
        } catch (RuntimeException ignored) {
            // 单元测试或非 HTTP 调用仍保留传入的操作人 ID。
        }
        audit.setAction(action);
        audit.setTargetType(targetType);
        audit.setTargetId(Texts.cut(targetId, 64));
        audit.setTargetName(Texts.cut(targetName, 128));
        audit.setResult("success");
        audit.setDetail(Texts.cut(detail, 500));
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes) {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            audit.setIp(Texts.cut(AuditService.clientIp(attrs.getRequest()), 64));
        }
        if (audits.insert(audit) != 1) {
            throw new IllegalStateException("Member label audit was not recorded");
        }
    }
}
