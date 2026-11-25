package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 应用内通知（N-1：不依赖外部 IM 的定向提醒） */
@Data
public class AppNotification {

    private Long id;
    private String userId;
    private String workspaceId;
    /** task_remind / task_due / task_assigned / task_comment */
    private String type;
    private String title;
    private String body;
    private String refTaskId;
    /** 非任务通知的关联对象：demand / doc / branch / version / project / workspace */
    private String refKind;
    private String refId;
    /** 通知对应业务对象所属项目：项目被设为不可见后，历史通知随之隐藏；空=不按项目过滤 */
    private String reqId;
    private LocalDateTime readAt;
    private LocalDateTime createdAt;

    /** 非表字段：来源空间名 */
    private String workspaceName;
    /** 非表字段：发布计划类通知的计划负责人显示名 */
    private String refOwnerName;
}
