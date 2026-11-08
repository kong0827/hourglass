package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 系统审计日志（登录、权限变更、导出/导入、删除/清空等安全事件） */
@Data
public class AuditLog {

    private Long id;
    /** 空间事件为空（如登录） */
    private String workspaceId;
    private String actorId;
    /** 操作人显示名；登录失败时为尝试账号 */
    private String actorName;
    private String action;
    private String targetType;
    private String targetId;
    private String targetName;
    /** success / fail */
    private String result;
    private String detail;
    private String ip;
    private LocalDateTime createdAt;
}
