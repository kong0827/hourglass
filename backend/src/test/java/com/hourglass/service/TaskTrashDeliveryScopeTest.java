package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TaskTrashDeliveryScopeTest {
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TaskCascade cascade = mock(TaskCascade.class);
    private final DeliveryScopeLock locks = mock(DeliveryScopeLock.class);
    private final VersionTaskMapper bindings = mock(VersionTaskMapper.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final TimeLogService timeLogs = mock(TimeLogService.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectAccessService access = spy(new ProjectAccessService(mock(ProjectMemberMapper.class), members));
    private final TaskTrashService service = new TaskTrashService(tasks, support, cascade,
            timeLogs, audit, access,
            mock(com.hourglass.mapper.MailDeliveryMapper.class), mock(NotificationEventService.class),
            mock(TaskWatchService.class), mock(PlatformTransactionManager.class), locks, bindings);
    private Task task;

    @BeforeEach
    void prepare() {
        task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setReqId("R1");
        task.setTitle("任务");
        task.setOwnerUserId("U-other");
        staleRole("member");
        currentSnapshot("R1", "member", null);
        when(support.require("W1", "K1")).thenReturn(task);
        when(support.requireDeleted("W1", "K1")).thenReturn(task);
        when(locks.lockTask("W1", "K1")).thenReturn(task);
    }

    @Test
    void publishedTaskCanSoftDeleteWithoutDetachingVersionsOrClearingBadge() {
        task.setPublishedAt(LocalDate.of(2026, 11, 9));
        task.setPublishedReleaseId("VR1"); task.setEverPublished(true);
        task.setVersionIds(java.util.Arrays.asList("V1", "V2"));
        service.delete("U1", "W1", "K1");
        verify(tasks).softDelete("K1");
        assertEquals(LocalDate.of(2026, 11, 9), task.getPublishedAt());
        assertEquals("VR1", task.getPublishedReleaseId());
        assertTrue(task.getEverPublished());
        assertEquals(java.util.Arrays.asList("V1", "V2"), task.getVersionIds());
        verifyNoInteractions(bindings, cascade);
    }

    @Test
    void publishedTaskPurgeDelegatesToCascadeWithoutRewritingHistory() {
        task.setPublishedAt(LocalDate.now());
        task.setDeletedAt(LocalDateTime.now());
        service.purge("W1", "K1");
        verify(cascade).purgeTasks("W1", java.util.Collections.singletonList("K1"));
        verifyNoInteractions(bindings);
    }

    @Test
    void softDeleteAfterRollbackPreservesHistoricalFactAndBindings() {
        task.setPublishedAt(null);
        task.setEverPublished(true);
        task.setPublicationState("rolled_back");
        task.setVersionIds(java.util.Arrays.asList("V1", "V2"));
        service.delete("U1", "W1", "K1");
        verify(tasks).softDelete("K1");
        InOrder order = inOrder(locks, access, tasks);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        order.verify(tasks).softDelete("K1");
        assertTrue(task.getEverPublished());
        assertEquals("rolled_back", task.getPublicationState());
        assertEquals(java.util.Arrays.asList("V1", "V2"), task.getVersionIds());
        verifyNoInteractions(bindings);
    }

    @Test
    void restoreFromSuccessfulVersionPreservesMembershipAndAuditsOnlyRestore() {
        task.setDeletedAt(LocalDateTime.now());
        task.setVersionIds(java.util.Collections.singletonList("V1"));
        task.setEverPublished(true);
        task.setPublicationState("effective");
        task.setPublishedAt(LocalDate.of(2026, 11, 9));
        task.setPublishSource("record");
        task.setPublishedReleaseId("VR1");
        service.restore("U1", "W1", "K1");
        InOrder order = inOrder(locks, access, bindings, audit, tasks);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        order.verify(tasks).restore("K1");
        verifyNoInteractions(bindings);
        verify(audit, never()).logChange(anyString(), anyString(), anyString(), eq("version_change"), anyString(), any(), any(), any());
        assertEquals(java.util.Collections.singletonList("V1"), task.getVersionIds());
        assertTrue(task.getEverPublished());
        assertEquals("effective", task.getPublicationState());
        assertEquals(LocalDate.of(2026, 11, 9), task.getPublishedAt());
        assertEquals("record", task.getPublishSource());
        assertEquals("VR1", task.getPublishedReleaseId());
        verify(audit).log(eq("U1"), eq("W1"), eq("K1"), eq("restore"), anyString());
    }

    @Test
    void restoreExistingPublishedAssociationDoesNotSilentlyRewriteEvidence() {
        task.setDeletedAt(LocalDateTime.now());
        task.setPublishedAt(LocalDate.now());
        task.setVersionIds(java.util.Collections.singletonList("V1"));
        ProjectVersion version = new ProjectVersion();
        version.setStatus("released");
        when(tasks.selectVersionForScope("W1", "V1")).thenReturn(version);
        service.restore("U1", "W1", "K1");
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verify(tasks).restore("K1");
    }

    @Test
    void restoreActiveVersionPreservesBinding() {
        task.setDeletedAt(LocalDateTime.now());
        task.setVersionIds(java.util.Collections.singletonList("V1"));
        ProjectVersion version = new ProjectVersion();
        version.setStatus("active");
        when(tasks.selectVersionForScope("W1", "V1")).thenReturn(version);
        service.restore("U1", "W1", "K1");
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
    }

    @Test
    void lockedPublicationNotObservedStateStillAllowsSoftDelete() {
        Task observed = new Task();
        observed.setReqId("R1");
        when(support.require("W1", "K1")).thenReturn(observed);
        LocalDate date = LocalDate.of(2026, 11, 9);
        task.setPublishedAt(date);
        service.delete("U1", "W1", "K1");
        verify(tasks).softDelete("K1");
        assertEquals(date, task.getPublishedAt());
        verifyNoInteractions(bindings, cascade);
    }

    @ParameterizedTest
    @CsvSource({"viewer,,403", "member,read,403", "member,none,404", ",,404"})
    void deleteAndRestoreDenyCurrentAccessBeforeAnyMutation(String role, String grant, int code) {
        staleRole("admin");
        currentSnapshot("R1", role, grant);
        assertEquals(code, assertThrows(AppException.class,
                () -> service.delete("U1", "W1", "K1")).getCode());
        task.setDeletedAt(LocalDateTime.now());
        assertEquals(code, assertThrows(AppException.class,
                () -> service.restore("U1", "W1", "K1")).getCode());

        InOrder order = inOrder(support, locks, access);
        order.verify(support).require("W1", "K1");
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        order.verify(support).requireDeleted("W1", "K1");
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        verify(access, never()).assertWrite(anyString(), anyString(), any());
        verifyNoInteractions(tasks, bindings, timeLogs, audit, cascade);
    }

    @ParameterizedTest
    @ValueSource(strings = {"delete", "restore"})
    void ordinaryNonOwnerWriterCanDeleteAndRestore(String entrypoint) {
        if ("restore".equals(entrypoint)) {
            task.setDeletedAt(LocalDateTime.now());
            service.restore("U1", "W1", "K1");
        } else {
            service.delete("U1", "W1", "K1");
        }
        InOrder order = inOrder(locks, access, tasks);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        if ("restore".equals(entrypoint)) {
            order.verify(tasks).restore("K1");
        } else {
            order.verify(tasks).softDelete("K1");
        }
        verify(access, never()).assertWrite(anyString(), anyString(), any());
        assertEquals("U-other", task.getOwnerUserId());
    }

    @ParameterizedTest
    @CsvSource({"viewer,403", ",404"})
    void uncategorizedDeleteAndRestoreStillRevalidateCurrentMembership(String role, int code) {
        task.setReqId(null);
        staleRole("owner");
        currentSnapshot(null, role, null);
        assertEquals(code, assertThrows(AppException.class,
                () -> service.delete("U1", "W1", "K1")).getCode());
        task.setDeletedAt(LocalDateTime.now());
        assertEquals(code, assertThrows(AppException.class,
                () -> service.restore("U1", "W1", "K1")).getCode());
        verify(access, times(2)).assertWriteForUpdate("W1", "U1", null);
        verify(members, times(2)).selectDeliveryAccessForUpdate("W1", "U1", null);
        verifyNoInteractions(tasks, bindings, timeLogs, audit, cascade);
    }

    private void staleRole(String role) {
        WorkspaceMember member = new WorkspaceMember();
        member.setRole(role);
        when(members.selectMember("W1", "U1")).thenReturn(member);
    }

    private void currentSnapshot(String projectId, String role, String grant) {
        Map<String, Object> snapshot = null;
        if (role != null) {
            snapshot = new HashMap<String, Object>();
            snapshot.put("role", role);
            snapshot.put("access", grant);
            snapshot.put("projectOwnerUserId", "U-other");
        }
        when(members.selectDeliveryAccessForUpdate("W1", "U1", projectId)).thenReturn(snapshot);
    }

    @Test
    void concurrentRestoreBlocksPurge() {
        Task observed = new Task();
        observed.setReqId("R1");
        observed.setDeletedAt(LocalDateTime.now());
        when(support.requireDeleted("W1", "K1")).thenReturn(observed);
        assertThrows(AppException.class, () -> service.purge("W1", "K1"));
        verifyNoInteractions(cascade);
    }
}
