package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 分支状态变更记录：详情页的时间线由它渲染。
 *
 * <p>与 {@link DevBranch} 上四个状态时间点的分工：时间点列只记「首次进入」，
 * 用来快速算发布周期、各阶段停留时长；日志表记**每一次**变动（含改回原状态、改名字段），
 * 用来回答「谁在什么时候把它从待测试退回了开发中」。
 */
@Data
public class DevBranchLog {

    private String id;
    private String workspaceId;
    private String branchId;
    /** create（新建）/ status（改状态）/ update（改基础信息） */
    private String action;
    private String fromStatus;
    private String toStatus;
    private String detail;
    private String actorName;
    private String actorUserId;
    private LocalDateTime createdAt;
}
