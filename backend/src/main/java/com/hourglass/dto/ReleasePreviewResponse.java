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
