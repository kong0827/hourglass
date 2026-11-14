package com.hourglass.entity;

import lombok.Data;

/** 工时聚合：既用于"按任务汇总"，也用于"按成员汇总"（N-5 下钻） */
@Data
public class TimeAgg {

    private String taskId;
    /** 按成员汇总时回填（sumByWorkspaceGroupByUser） */
    private String userId;
    private Integer totalMinutes;
    /** 按任务拆分工时时回填：落在测试窗口内的已结束计时（其余计入开发） */
    private Integer testMinutes;
}
