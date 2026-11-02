package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** 任务字段批量维护（MGT-020）：绑定负责人/补截止日期；done 任务会被跳过。 */
@Data
public class BulkTaskMetaRequest {

    private List<String> taskIds = new ArrayList<String>();
    private String ownerUserId;
    private LocalDate dueDate;
}
