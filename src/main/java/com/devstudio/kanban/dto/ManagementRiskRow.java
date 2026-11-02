package com.devstudio.kanban.dto;

import lombok.Data;

/** 风险清单行。days 只对时间锚点风险有值，其余为 null。 */
@Data
public class ManagementRiskRow {

    private String type;
    private String severity;
    private String projectId;
    private String projectName;
    private String manager;
    private Integer days;
    private String reason;
    private String evidence;
    private String suggestedAction;
    private String target;
}
