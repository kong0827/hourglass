package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Min;
import javax.validation.constraints.Pattern;
import java.time.LocalDate;

/** 人工交付判定：只允许已完成待发布 / 已交付两个终态，必须填写生效日期与原因。 */
@Data
public class DemandDeliveryJudgementRequest {

    @Pattern(regexp = "donePending|delivered", message = "人工判定阶段不合法")
    private String stage;

    private LocalDate effectiveOn;

    private String note;

    @Min(value = 0, message = "revision 不合法")
    private Long revision;
}
