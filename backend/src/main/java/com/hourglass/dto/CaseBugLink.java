package com.hourglass.dto;

import lombok.Data;

/** 缺陷反查用例：执行流水里记录过的 bug_task_id → 用例，缺陷 tab 展示来源用例用 */
@Data
public class CaseBugLink {

    private String bugTaskId;

    private String caseId;

    private String caseTitle;
}
