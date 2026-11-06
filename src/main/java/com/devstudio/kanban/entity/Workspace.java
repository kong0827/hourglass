package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Workspace {

    private String id;
    private String name;
    /** personal/shared */
    private String type;
    private String notifyWebhook;
    private String ownerId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /* ---- 2026-10-16 评估报告改造新增（O-1：渠道从全局环境变量下沉到空间级） ---- */
    /** webhook / serverchan / pushplus；空=跟随全局 NOTIFY_TYPE */
    private String notifyChannel;
    /** 空间推送开关：null=跟随全局，true=开，false=关 */
    private Boolean notifyEnabled;
    /** 站内通知开关：null=启用（默认），false=只停站内汇总/提醒，不影响外部推送 */
    private Boolean notifyInAppEnabled;
    /** Server酱 SendKey / PushPlus token；空=用全局 */
    private String notifyToken;
    /** 上次推送尝试时间（设置页「是否真正生效」的依据） */
    private LocalDateTime notifyLastAt;
    /** success / failed:原因 */
    private String notifyLastStatus;

    /** 非表字段：当前用户在该空间的角色 owner/member */
    private String myRole;
    /** 非表字段：成员数 */
    private Integer memberCount;
    /** 非表字段：当前用户的项目级范围 projectId → read/none；无记录即默认可见可写 */
    private java.util.Map<String, String> projectAccess;
}
