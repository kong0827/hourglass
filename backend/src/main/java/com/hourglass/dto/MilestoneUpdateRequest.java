package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;

/** 只改描述字段；日期走改期、条件创建后不改、状态不可编辑 */
@Data
public class MilestoneUpdateRequest {

    @Size(max = 120)
    private String name;
    private String ownerUserId;
    private Boolean keyMilestone;
    @Size(max = 500)
    private String note;
    private Long revision;
}
