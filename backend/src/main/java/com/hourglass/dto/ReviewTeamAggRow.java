package com.hourglass.dto;

import lombok.Data;

/** 团队周回顾的通用聚合行：key 为分组键，count / value 为数值。 */
@Data
public class ReviewTeamAggRow {
    private String key;
    private String userId;
    private String name;
    private String projectId;
    private String projectName;
    private Integer count;
    private Integer value;
}
