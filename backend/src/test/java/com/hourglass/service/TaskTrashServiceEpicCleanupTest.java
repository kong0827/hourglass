package com.hourglass.service;

import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** P0 修复回归：Epic 进回收站（软删除）后其子任务立即解除归属。 */
class TaskTrashServiceEpicCleanupTest {

    private final DeliveryScopeLock scopeLock = mock(DeliveryScopeLock.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TaskCascade cascade = mock(TaskCascade.class);
    private final TimeLogService timeLog = mock(TimeLogService.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final AuditService systemAudit = mock(AuditService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final TaskTrashService service = new TaskTrashService(tasks, support, cascade, timeLog, audit,
            access, mock(com.hourglass.mapper.MailDeliveryMapper.class),
            mock(NotificationEventService.class), mock(TaskWatchService.class),
            mock(PlatformTransactionManager.class), scopeLock,
            mock(com.hourglass.mapper.VersionTaskMapper.class), systemAudit,
            mock(com.hourglass.mapper.UserMapper.class));

    @Test
    void softDeletingEpicClearsChildrenEpicRefs() {
        Task epic = new Task();
        epic.setId("K1");
        epic.setWorkspaceId("W1");
        epic.setTitle("Epic");
        epic.setItemType("epic");
        when(support.require("W1", "K1")).thenReturn(epic);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(epic);

        service.delete("U1", "W1", "K1");

        verify(tasks).softDelete("K1");
        verify(tasks).clearEpicChildren("W1", "K1");
        verify(timeLog).closeRunningForTask("W1", "K1", "U1", "任务已移入回收站");
        verify(audit).log("U1", "W1", "K1", "delete", "移入回收站「Epic」（30 天后自动清理）");
    }

    @Test
    void purgingEpicDelegatesToCascade() {
        Task epic = new Task();
        epic.setId("K1");
        epic.setWorkspaceId("W1");
        epic.setTitle("Epic");
        epic.setDeletedAt(java.time.LocalDateTime.now());
        when(support.requireDeleted("W1", "K1")).thenReturn(epic);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(epic);

        service.purge("U1", "W1", "K1");

        verify(systemAudit).record(eq("W1"), eq("U1"), eq("U1"), eq("task_purge"), eq("task"),
                eq("K1"), eq("Epic"), eq(true), contains("未归属项目"), isNull());
        verify(cascade).purgeTasks("W1", Collections.singletonList("K1"));
    }
}
