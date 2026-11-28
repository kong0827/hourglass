package com.hourglass.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** 发布计划只读分享页的公开投影：只含计划范围与时间，不含备注、风险与内部检查。 */
public class PublicReleasePlanView {

    private String workspaceName;
    private Integer planNo;
    private String title;
    private String status;
    private LocalDateTime plannedAt;
    private String environment;
    private String coverage;
    private String ownerName;
    private Integer versionCount;
    private Integer releasedCount;
    private Integer taskCount;
    private LocalDateTime planUpdatedAt;
    private LocalDateTime generatedAt;
    private List<VersionRow> versions = new ArrayList<VersionRow>();
    private List<TaskRow> tasks = new ArrayList<TaskRow>();

    public static class VersionRow {
        private String versionName;
        private String projectName;
        private String status;
        private LocalDate targetDate;
        private Boolean released;

        public String getVersionName() { return versionName; }
        public void setVersionName(String versionName) { this.versionName = versionName; }

        public String getProjectName() { return projectName; }
        public void setProjectName(String projectName) { this.projectName = projectName; }

        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }

        public LocalDate getTargetDate() { return targetDate; }
        public void setTargetDate(LocalDate targetDate) { this.targetDate = targetDate; }

        public Boolean getReleased() { return released; }
        public void setReleased(Boolean released) { this.released = released; }
    }

    public static class TaskRow {
        private Integer itemNo;
        private String title;
        private String itemType;
        private String boardColumn;
        private String ownerName;
        private String projectName;
        private String versionNames;
        private LocalDate dueDate;

        public Integer getItemNo() { return itemNo; }
        public void setItemNo(Integer itemNo) { this.itemNo = itemNo; }

        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }

        public String getItemType() { return itemType; }
        public void setItemType(String itemType) { this.itemType = itemType; }

        public String getBoardColumn() { return boardColumn; }
        public void setBoardColumn(String boardColumn) { this.boardColumn = boardColumn; }

        public String getOwnerName() { return ownerName; }
        public void setOwnerName(String ownerName) { this.ownerName = ownerName; }

        public String getProjectName() { return projectName; }
        public void setProjectName(String projectName) { this.projectName = projectName; }

        public String getVersionNames() { return versionNames; }
        public void setVersionNames(String versionNames) { this.versionNames = versionNames; }

        public LocalDate getDueDate() { return dueDate; }
        public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; }
    }

    public String getWorkspaceName() { return workspaceName; }
    public void setWorkspaceName(String workspaceName) { this.workspaceName = workspaceName; }

    public Integer getPlanNo() { return planNo; }
    public void setPlanNo(Integer planNo) { this.planNo = planNo; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public LocalDateTime getPlannedAt() { return plannedAt; }
    public void setPlannedAt(LocalDateTime plannedAt) { this.plannedAt = plannedAt; }

    public String getEnvironment() { return environment; }
    public void setEnvironment(String environment) { this.environment = environment; }

    public String getCoverage() { return coverage; }
    public void setCoverage(String coverage) { this.coverage = coverage; }

    public String getOwnerName() { return ownerName; }
    public void setOwnerName(String ownerName) { this.ownerName = ownerName; }

    public Integer getVersionCount() { return versionCount; }
    public void setVersionCount(Integer versionCount) { this.versionCount = versionCount; }

    public Integer getReleasedCount() { return releasedCount; }
    public void setReleasedCount(Integer releasedCount) { this.releasedCount = releasedCount; }

    public Integer getTaskCount() { return taskCount; }
    public void setTaskCount(Integer taskCount) { this.taskCount = taskCount; }

    public LocalDateTime getPlanUpdatedAt() { return planUpdatedAt; }
    public void setPlanUpdatedAt(LocalDateTime planUpdatedAt) { this.planUpdatedAt = planUpdatedAt; }

    public LocalDateTime getGeneratedAt() { return generatedAt; }
    public void setGeneratedAt(LocalDateTime generatedAt) { this.generatedAt = generatedAt; }

    public List<VersionRow> getVersions() { return versions; }
    public void setVersions(List<VersionRow> versions) { this.versions = versions; }

    public List<TaskRow> getTasks() { return tasks; }
    public void setTasks(List<TaskRow> tasks) { this.tasks = tasks; }
}
