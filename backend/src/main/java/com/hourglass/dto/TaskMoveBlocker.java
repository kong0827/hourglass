package com.hourglass.dto;

import lombok.Data;

/** 需求迁移前的工作项阻断证据：一条记录 = 某工作项存在某类不可回退的交付事实。 */
@Data
public class TaskMoveBlocker {

    /** 证据类型：publish=发布记录或人工发布标记 / frozen=绑定已关闭或已取消的版本 */
    public static final String PUBLISH = "publish";
    public static final String FROZEN = "frozen";

    private String taskId;
    private String reason;
}
