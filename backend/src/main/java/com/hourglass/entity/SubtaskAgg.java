package com.hourglass.entity;

import lombok.Data;

/**
 * 子任务按任务聚合计数（看板卡片角标用）
 */
@Data
public class SubtaskAgg {

    private String taskId;
    private Integer total;
    private Integer done;
}
