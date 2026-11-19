package com.hourglass.dto;

import lombok.Data;

/** 需求迁移前的工作项阻断证据：一条记录 = 某工作项存在某类执行证据。 */
@Data
public class TaskMoveBlocker {

    /** 证据类型：version=版本绑定 / case=用例关联 / time=工时记录 / publish=发布标记 */
    public static final String VERSION = "version";
    public static final String CASE = "case";
    public static final String TIME = "time";
    public static final String PUBLISH = "publish";

    private String taskId;
    private String reason;
}
