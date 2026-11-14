package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Data
public class ReleasePreviewResponse {
    private String versionId;
    private String planId;
    private java.time.OffsetDateTime occurredAt;
    private String environment;
    private List<String> targetKeys;
    private String coverage;
    private List<String> actualTaskIds;
    private List<String> plannedTaskIds;
    private boolean requiresDeviationReason;
    private Long planRevision;
    private String scopeToken;
    private LocalDate publishedOn;
    private boolean canPublish;
    private List<Task> candidates = new ArrayList<Task>();
    private List<ExcludedTask> excluded = new ArrayList<ExcludedTask>();
    private List<String> warnings = new ArrayList<String>();
    /** 发布前测试检查（只读）：阻断项会让 canPublish=false，除非填写偏离理由 */
    private ReleaseCheckResponse testCheck;

    @Data
    public static class ExcludedTask {
        private Task task;
        private String reason;

        public ExcludedTask(Task task, String reason) {
            this.task = task;
            this.reason = reason;
        }
    }
}
