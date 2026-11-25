package com.hourglass.dto;

import lombok.Data;

/** 本周到期工作项的完成结果：按期 / 延期 / 仍未完成。 */
@Data
public class ReviewTeamDueRow {
    private Integer total;
    private Integer onTime;
    private Integer late;
    private Integer openCount;
}
