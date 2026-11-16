package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** 批量人工标记：单次最多 100 条，整批在一个事务内完成。 */
@Data
public class TaskPublicationJudgementBatchRequest {

    private List<String> taskIds = new ArrayList<String>();

    private LocalDate effectiveOn;

    private String note;
}
