package com.hourglass.dto;

import lombok.Data;

/**
 * 取消工作项（进入终态「已取消」）。
 *
 * <p>原因固定四类，说明必填：取消不是一次普通改字段，它决定这张卡是否退出逾期、
 * 完成率分母与需求完成分母，恢复时要靠说明判断该不该捡回来。
 * 原因与说明的枚举 / 长度由 TaskWorkflowService 统一校验，避免前端绕开。
 */
@Data
public class TaskCancelRequest {

    /** 取消原因码：not_do / dup / deferred / design */
    private String reason;

    /** 取消说明（必填，写清为什么不做） */
    private String note;
}
