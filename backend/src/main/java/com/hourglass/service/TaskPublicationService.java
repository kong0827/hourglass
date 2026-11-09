package com.hourglass.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Service
public class TaskPublicationService {
    private final TaskMapper taskMapper;
    private final ReleaseMapper releaseMapper;
    private final ReleasePermissionService permissions;

    public TaskPublicationService(TaskMapper taskMapper, ReleaseMapper releaseMapper, TaskLogMapper logMapper,
                                  DeliveryScopeLock scopeLock, ReleasePermissionService permissions, ObjectMapper json) {
        this.taskMapper = taskMapper;
        this.releaseMapper = releaseMapper;
        this.permissions = permissions;
    }

    /** Read-only projection; callers must have already applied task/project visibility. */
    public void enrichTasks(String workspaceId, List<Task> tasks) {
        java.util.List<String> ids = new java.util.ArrayList<String>();
        for (Task task : tasks) if (workspaceId.equals(task.getWorkspaceId()) && !ids.contains(task.getId())) ids.add(task.getId());
        java.util.Map<String, PublicationSummary> summaries = new java.util.HashMap<String, PublicationSummary>();
        for (int start = 0; start < ids.size(); start += 500) {
            List<String> batch = ids.subList(start, Math.min(start + 500, ids.size()));
            List<VersionRelease> records = releaseMapper.selectPublicationRecords(workspaceId, batch);
            for (String id : batch) summaries.put(id, project(id, records));
        }
        for (Task task : tasks) {
            PublicationSummary summary = summaries.get(task.getId());
            if (summary == null) summary = new PublicationSummary();
            task.setPublishedAt(summary.getPublishedAt());
            task.setPublishSource(summary.getLatestEffectiveRecord() == null ? null : "record");
            task.setPublishedReleaseId(summary.getLatestEffectiveRecord() == null ? null : summary.getLatestEffectiveRecord().getId());
            task.setCanPublish(false); task.setCanUnpublish(false);
            task.setEverPublished(summary.isEverPublished()); task.setPublicationState(summary.getPublicationState());
            task.setPublicationTargets(summary.getPublicationTargets());
        }
    }

    @lombok.Data
    public static class PublicationSummary {
        private boolean everPublished;
        private String publicationState = "unpublished";
        private List<String> publicationTargets = new java.util.ArrayList<String>();
        private LocalDate publishedAt;
        private VersionRelease latestEffectiveRecord;
    }

    /** Occurrence order, not arrival order. A rollback cancels only its referenced task-target fact. */
    public PublicationSummary project(String taskId, List<VersionRelease> records) {
        PublicationSummary summary = new PublicationSummary();
        List<VersionRelease> sorted = new java.util.ArrayList<VersionRelease>(records);
        java.util.Comparator<VersionRelease> order = java.util.Comparator
                .comparing(VersionRelease::getOccurredAt, java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder()))
                .thenComparing(VersionRelease::getRecordedAt, java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder()))
                .thenComparing(VersionRelease::getId);
        sorted.sort(order);
        Map<String, VersionRelease> current = new java.util.TreeMap<String, VersionRelease>();
        java.util.Set<String> knownTargets = new java.util.TreeSet<String>();
        java.util.Set<String> unknownScopeRecords = new java.util.HashSet<String>();
        for (VersionRelease record : sorted) {
            if (!"success".equals(record.getResult()) || !"production".equals(record.getEnvironment())) continue;
            boolean actual = false;
            for (com.hourglass.entity.VersionReleaseItem item : record.getItems()) {
                if (taskId.equals(item.getTaskId()) && ("published".equals(item.getDisposition()) || "rolled_back".equals(item.getDisposition()))) { actual = true; break; }
            }
            if (!actual) continue;
            if ("rollback".equals(record.getOperation())) {
                for (String target : record.getTargetKeys()) {
                    VersionRelease effective = current.get(target);
                    if (effective != null && effective.getId().equals(record.getRelatedReleaseId())) current.remove(target);
                }
            } else {
                summary.setEverPublished(true);
                if (record.getTargetKeys().isEmpty()) unknownScopeRecords.add(record.getId());
                for (String target : record.getTargetKeys()) { knownTargets.add(target); current.put(target, record); }
            }
        }
        VersionRelease latest = null;
        boolean unknown = !unknownScopeRecords.isEmpty();
        boolean partial = current.size() < knownTargets.size();
        for (VersionRelease record : current.values()) {
            if (latest == null || order.compare(record, latest) > 0) latest = record;
            if (!"full".equals(record.getCoverage())) partial = true;
            if ("unknown".equals(record.getCoverage())) unknown = true;
        }
        summary.setPublicationTargets(new java.util.ArrayList<String>(current.keySet()));
        // Unknown coverage never claims a verified full production deployment.
        summary.setPublicationState(unknown ? "unknown" : current.isEmpty() ? (summary.isEverPublished() ? "rolled_back" : "unpublished") : partial ? "partial" : "effective");
        summary.setLatestEffectiveRecord(latest);
        summary.setPublishedAt(latest == null ? null : latest.getOccurredAt().toLocalDate());
        return summary;
    }

    public List<VersionRelease> records(String userId, String workspaceId, String taskId) {
        Task current = taskMapper.selectById(taskId);
        if (current != null && workspaceId.equals(current.getWorkspaceId())) return visibleRecords(userId, workspaceId, current);
        // Immutable historical identity survives physical task removal.
        List<VersionRelease> visible = new java.util.ArrayList<VersionRelease>();
        for (VersionRelease record : releaseMapper.selectTaskRecords(workspaceId, taskId)) {
            if (permissions.canViewProject(userId, workspaceId, record.getReqId())) {
                record.setItems(releaseMapper.selectItems(workspaceId, record.getId()));
                visible.add(record);
            }
        }
        if (visible.isEmpty()) throw AppException.notFound("任务或可见发布历史不存在");
        return visible;
    }

    private List<VersionRelease> visibleRecords(String userId, String workspaceId, Task task) {
        permissions.assertViewTask(userId, workspaceId, task);
        List<VersionRelease> records = new java.util.ArrayList<VersionRelease>();
        for (VersionRelease record : releaseMapper.selectTaskRecords(workspaceId, task.getId())) {
            if (permissions.canViewProject(userId, workspaceId, record.getReqId())) {
                record.setItems(releaseMapper.selectItems(workspaceId, record.getId()));
                records.add(record);
            }
        }
        return records;
    }

}
