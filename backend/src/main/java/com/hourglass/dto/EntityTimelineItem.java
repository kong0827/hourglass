package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 单实体变更记录：从 audit_log 按 target_type + target_id 取出，供用例/计划详情就地追溯。 */
@Data
public class EntityTimelineItem {
    private Long id;
    private String action;
    private String actionLabel;
    private String actorName;
    private String detail;
    private String result;
    private LocalDateTime createdAt;
}
