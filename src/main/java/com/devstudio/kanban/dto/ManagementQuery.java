package com.devstudio.kanban.dto;

import lombok.Data;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDate;

/** 管理项目列表筛选。 */
@Data
public class ManagementQuery {
    private String riskLevel;
    private String status;
    private String manager;
    private String keyword;
    private String statusIssue;
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate dueFrom;
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate dueTo;
    private String sort = "risk";
    private Integer offset;
    private Integer limit;
}
