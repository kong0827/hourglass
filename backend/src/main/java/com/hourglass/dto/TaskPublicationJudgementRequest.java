package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 工作项历史发布人工标记：必须填写生效日期与原因；撤销只要求原因。 */
@Data
public class TaskPublicationJudgementRequest {

    private LocalDate effectiveOn;

    private String note;
}
