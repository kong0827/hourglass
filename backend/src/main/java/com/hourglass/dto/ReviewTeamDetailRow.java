package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 团队周回顾明细行：不同 key 复用一个窄结构，前端按 kind 决定是否可点。 */
@Data
public class ReviewTeamDetailRow {
    private String id;
    private String kind;
    private String type;
    private String title;
    private String projectName;
    private String person;
    private LocalDateTime at;
    /** 补充说明：状态 / 结果 / 关闭原因等 */
    private String extra;
    private Integer number;
}
