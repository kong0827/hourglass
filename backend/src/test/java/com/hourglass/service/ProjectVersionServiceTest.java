package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ProjectVersionSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.InOrder;

import java.io.InputStream;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ProjectVersionServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final VersionTaskMapper versionTasks = mock(VersionTaskMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final DeliveryScopeLock lock = mock(DeliveryScopeLock.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final ReleaseMapper releases = mock(ReleaseMapper.class);
    private final VersionReleaseService releaseService = mock(VersionReleaseService.class);
    private final TaskAuditLogger taskAudit = mock(TaskAuditLogger.class);
    private final Map<String, List<String>> taskBindings = new HashMap<>();
    private final DeletionTraceService deletionTrace = mock(DeletionTraceService.class);
    private final ProjectVersionService service = new ProjectVersionService(versions, versionTasks, tasks, reqs,
            access, lock, permissions, releases, releaseService, deletionTrace);

    @BeforeEach
    void setUp() {
        // update/start 使用 CAS 行数，Mockito 默认的 0 会误判为并发冲突。
        ReflectionTestUtils.setField(service, "taskAudit", taskAudit);
        when(versions.deleteById(anyString(), anyString())).thenReturn(1);
        when(versionTasks.insertBatch(anyString(), anyString(), anyList())).thenReturn(1);
        when(versionTasks.deleteBinding(anyString(), anyString(), anyString())).thenReturn(1);
        when(tasks.selectTaskVersionsForScope(eq(WS), anyString())).thenAnswer(invocation ->
                taskBindings.getOrDefault(invocation.getArgument(1), Collections.emptyList()));
        when(versions.update(any(ProjectVersion.class))).thenReturn(1);
        when(tasks.touchDeliveryRevision(anyString(), anyString())).thenReturn(1);
        when(releases.selectDemandsByProjectForUpdate(anyString(), anyString())).thenReturn(Collections.emptyList());
        when(releases.selectRecordsForUpdate(anyString(), anyString())).thenReturn(Collections.emptyList());
        when(releases.selectActiveTasksByProjectForUpdate(anyString(), anyString())).thenReturn(Collections.emptyList());
        when(releases.selectAllTasksByProjectForUpdate(anyString(), anyString())).thenReturn(Collections.emptyList());
        when(releases.selectRecordsByProjectForUpdate(anyString(), anyString())).thenReturn(Collections.emptyList());
    }

    @ParameterizedTest
    @ValueSource(strings = {"planned", "active"})
    void deleteUnreferencedVersionChecksCurrentScopeWithoutErasingPlanHistory(String status) {
        ProjectVersion version = version("V1", "R1");
        version.setStatus(status);
        mockVersion(version);

        service.delete(USER, WS, "V1");

        InOrder order = inOrder(lock, releases, versions);
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(versions).selectByIdForUpdate(WS, "V1");
        order.verify(releases).selectRecordsForUpdate(WS, "V1");
        order.verify(releases).selectAllTasksByProjectForUpdate(WS, "R1");
        order.verify(releases).selectDemandsByProjectForUpdate(WS, "R1");
        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
        verify(deletionTrace).recordDelete(eq(WS), eq(USER), eq("version_delete"), eq("project_version"),
                eq("V1"), eq("V1"), eq("删除版本「V1」（项目 R1；测试计划中的版本引用一并解除）"));
        verify(tasks).selectVersionPlanIdsForScope(WS, "V1");
        verify(tasks).selectVersionAuditIdsForScope(WS, "V1");
        order.verify(versions).deleteById(WS, "V1");
        verify(access).assertWrite(WS, USER, "R1");
        verifyNoInteractions(versionTasks, releaseService);
        verify(tasks, never()).update(any(Task.class));
        verify(tasks, never()).touchDeliveryRevision(anyString(), anyString());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void deleteRejectsAnyBoundTaskIncludingTrashWithoutMutation(boolean trashed) {
        ProjectVersion version = version("V1", "R1");
        mockVersion(version);
        Task bound = task("T1", "V1", "U2");
        LocalDateTime timestamp = LocalDateTime.of(2026, 11, 9, 12, 0);
        bound.setUpdatedAt(timestamp);
        bound.setDeletedAt(trashed ? timestamp : null);
        when(releases.selectAllTasksByProjectForUpdate(WS, "R1")).thenReturn(Arrays.asList(
                task("T-other", "V2", "U3"), bound));
        // Active options can miss a newly committed binding or a trashed task.
        when(versionTasks.selectOptionsByReq(WS, "R1")).thenReturn(Collections.emptyList());

        AppException error = assertThrows(AppException.class, () -> service.delete(USER, WS, "V1"));

        assertEquals(422, error.getCode());
        assertTrue(error.getMessage().contains("填写原因"));
        InOrder order = inOrder(lock, releases);
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(releases).selectAllTasksByProjectForUpdate(WS, "R1");
        assertDeleteDidNotMutate();
        assertEquals(Collections.singletonList("V1"), bound.getVersionIds());
        assertEquals(timestamp, bound.getUpdatedAt());
        assertEquals(trashed ? timestamp : null, bound.getDeletedAt());
        assertEquals("active", version.getStatus());
        assertEquals(0L, version.getRevision());
    }

    @ParameterizedTest
    @ValueSource(strings = {"plan", "pass", "review", "rej", "canceled"})
    void deleteRejectsAnyDemandReferenceAndPreservesStatusDatesAndRevision(String status) {
        mockVersion(version("V1", "R1"));
        Demand demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId(WS);
        demand.setReqId("R1");
        demand.setVersionId("V1");
        demand.setStatus(status);
        demand.setPlannedStart(LocalDate.of(2026, 11, 9));
        demand.setPlannedEnd(LocalDate.of(2026, 11, 12));
        demand.setRevision(7L);
        demand.setReviewNote("原排期原因");
        when(releases.selectDemandsByProjectForUpdate(WS, "R1"))
                .thenReturn(Collections.singletonList(demand));

        AppException error = assertThrows(AppException.class, () -> service.delete(USER, WS, "V1"));

        assertEquals(422, error.getCode());
        assertTrue(error.getMessage().contains("填写原因"));
        InOrder order = inOrder(lock, releases);
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(releases).selectAllTasksByProjectForUpdate(WS, "R1");
        order.verify(releases).selectDemandsByProjectForUpdate(WS, "R1");
        assertDeleteDidNotMutate();
        assertEquals("V1", demand.getVersionId());
        assertEquals(status, demand.getStatus());
        assertEquals(LocalDate.of(2026, 11, 9), demand.getPlannedStart());
        assertEquals(LocalDate.of(2026, 11, 12), demand.getPlannedEnd());
        assertEquals(7L, demand.getRevision());
        assertEquals("原排期原因", demand.getReviewNote());
    }

    @Test
    void deleteIgnoresTaskAndDemandReferencesToOtherVersions() {
        mockVersion(version("V1", "R1"));
        Task other = task("T-other", "V2", USER);
        other.setDeletedAt(LocalDateTime.now());
        other.setPublishedAt(LocalDate.now());
        when(releases.selectAllTasksByProjectForUpdate(WS, "R1"))
                .thenReturn(Arrays.asList(other, task("T-unplanned", null, USER)));
        Demand demand = new Demand();
        demand.setVersionId("V2");
        when(releases.selectDemandsByProjectForUpdate(WS, "R1"))
                .thenReturn(Arrays.asList(demand, new Demand()));

        service.delete(USER, WS, "V1");

        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
        verify(versions).deleteById(WS, "V1");
        verifyNoInteractions(versionTasks, releaseService);
        verify(tasks, never()).update(any(Task.class));
        verify(tasks, never()).touchDeliveryRevision(anyString(), anyString());
        assertEquals(Collections.singletonList("V2"), other.getVersionIds());
        assertEquals("V2", demand.getVersionId());
    }

    @Test
    void createRejectsTaskThatDoesNotBelongToProject() {
        when(reqs.selectById("R1")).thenReturn(requirement("R1"));
        when(versions.selectByNameForUpdate(WS, "R1", "V1.0", null)).thenReturn(Collections.emptyList());
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1")).thenReturn(Collections.emptyList());

        ProjectVersionSaveRequest request = new ProjectVersionSaveRequest();
        request.setReqId("R1");
        request.setName("V1.0");
        request.setTaskIds(Collections.singletonList("T9"));

        AppException error = assertThrows(AppException.class, () -> service.create(USER, WS, request));

        assertEquals(400, error.getCode());
        verify(versionTasks, never()).deleteByVersion(anyString(), anyString());
        verify(versionTasks, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @Test
    void rejectsDuplicateVersionNameWithinProject() {
        when(reqs.selectById("R1")).thenReturn(requirement("R1"));
        when(versions.selectByNameForUpdate(WS, "R1", "V1.0", null))
                .thenReturn(Collections.singletonList(version("V-other", "R1")));

        ProjectVersionSaveRequest request = new ProjectVersionSaveRequest();
        request.setReqId("R1");
        request.setName("V1.0");

        AppException error = assertThrows(AppException.class, () -> service.create(USER, WS, request));

        assertEquals(400, error.getCode());
        verify(versions, never()).insert(any(ProjectVersion.class));
    }

    @Test
    void startMovesPlannedToActiveAndFillsMissingStartDate() {
        ProjectVersion planned = version("V1", "R1");
        planned.setStatus("planned");
        planned.setStartDate(null);
        mockVersion(planned);

        ProjectVersion result = service.start(USER, WS, "V1");

        assertSame(planned, result);
        assertEquals("active", planned.getStatus());
        assertNotNull(planned.getStartDate());
        verify(versions).update(planned);
        verify(access).assertWrite(WS, USER, "R1");
    }

    @Test
    void startKeepsExistingStartDateAndSkipsUpdateWhenAlreadyActive() {
        ProjectVersion active = version("V1", "R1");
        mockVersion(active);

        service.start(USER, WS, "V1");

        verify(versions, never()).update(any(ProjectVersion.class));
    }

    @Test
    void startRejectsReleasedVersion() {
        ProjectVersion released = version("V1", "R1");
        released.setStatus("released");
        mockVersion(released);

        AppException error = assertThrows(AppException.class, () -> service.start(USER, WS, "V1"));

        assertEquals(400, error.getCode());
        verify(versions, never()).update(any(ProjectVersion.class));
    }

    @Test
    void updateRejectsReleasedVersion() {
        ProjectVersion released = version("V1", "R1");
        released.setStatus("released");
        mockVersion(released);
        when(versions.selectByNameForUpdate(WS, "R1", "V1", "V1")).thenReturn(Collections.emptyList());

        ProjectVersionSaveRequest request = new ProjectVersionSaveRequest();
        request.setReqId("R1");
        request.setName("V1");
        request.setRevision(0L);

        AppException error = assertThrows(AppException.class, () -> service.update(USER, WS, "V1", request));

        assertEquals(400, error.getCode());
        verify(versions, never()).update(any(ProjectVersion.class));
    }

    @Test
    void updateAllowsOrdinaryMetadataAndWritesVersionHistory() {
        ProjectVersion version = version("V1", "R1");
        mockVersion(version);
        ProjectVersionSaveRequest request = updateRequest();
        request.setName("  1.1  ");
        assertSame(version, service.update(USER, WS, "V1", request));
        assertEquals("1.1", version.getName());
        verify(versions).update(version);
        verify(releaseService).log(USER, WS, "V1", "version_update", null, null, request);
    }

    @ParameterizedTest
    @ValueSource(strings = {"start", "update"})
    void zeroUpdatedRowsAreReportedAsConflict(String operation) {
        ProjectVersion version = version("V1", "R1");
        version.setStatus("planned");
        mockVersion(version);
        when(versions.update(any())).thenReturn(0);
        AppException error = assertThrows(AppException.class, () -> {
            if ("start".equals(operation)) service.start(USER, WS, "V1");
            else service.update(USER, WS, "V1", updateRequest());
        });
        assertEquals(409, error.getCode());
        verifyNoInteractions(releaseService);
    }

    @Test
    void staleVersionRevisionIsRejectedBeforeAnyUpdate() {
        ProjectVersion version = version("V1", "R1");
        version.setRevision(3L);
        mockVersion(version);
        ProjectVersionSaveRequest request = updateRequest();
        request.setRevision(2L);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.update(USER, WS, "V1", request)).getCode());
        verify(versions, never()).update(any());
    }

    @Test
    void batchVersionChangesRequireReasonBeforeChangingTaskLinks() {
        mockVersion(version("V1", "R1"));
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1"))
                .thenReturn(Collections.singletonList(task("T1", null, USER)));
        ProjectVersionSaveRequest request = updateRequest();
        request.setTaskIds(Collections.singletonList("T1"));
        request.setTaskChangeReason(" ");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.update(USER, WS, "V1", request)).getCode());
        verify(versionTasks, never()).deleteByTaskId(anyString(), anyString());
        verify(versionTasks, never()).insertBatch(anyString(), anyString(), anyList());
        verify(lock, never()).lockTask(anyString(), anyString());
        verify(tasks).selectTaskVersionsForScope(WS, "T1");
        verify(tasks, never()).touchDeliveryRevision(anyString(), anyString());
        verify(tasks, never()).update(any(Task.class));
    }

    @Test
    void batchIncrementalChangesRequireManagementAndPreserveOtherMembershipAndAuditArrays() {
        mockVersion(version("V1", "R1"));
        Task attach = task("T1", null, USER);
        Task detach = task("T2", "V1", USER);
        detach.setVersionIds(Arrays.asList("V1", "V2"));
        taskBindings.put("T2", Arrays.asList("V1", "V2"));
        Task move = task("T3", "V2", USER);
        move.setPublishedAt(LocalDate.of(2026, 11, 9));
        move.setDescription("保留描述");
        move.setBoardColumn("doing");
        move.setProgress(45);
        move.setStartDate(LocalDate.of(2026, 11, 9));
        move.setDueDate(LocalDate.of(2026, 11, 12));
        move.setUpdatedAt(LocalDateTime.of(2026, 11, 9, 12, 0));
        Task alreadySelected = task("T4", "V1", USER);
        Task otherVersion = task("T5", "V2", USER);
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1"))
                .thenReturn(Arrays.asList(move, detach, attach, alreadySelected, otherVersion));
        for (Task task : Arrays.asList(attach, detach, move)) {
            when(lock.lockTask(WS, task.getId())).thenReturn(task);
        }
        ProjectVersionSaveRequest request = updateRequest();
        request.setTaskIds(Arrays.asList("T1", "T3", "T1", "T4"));
        request.setTaskChangeReason("  调整交付范围  ");
        service.update(USER, WS, "V1", request);

        InOrder order = inOrder(lock, releases, versionTasks, tasks, permissions, taskAudit);
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(releases).selectActiveTasksByProjectForUpdate(WS, "R1");
        order.verify(permissions).assertManageProjectForUpdate(USER, WS, "R1");
        order.verify(lock).lockTask(WS, "T1");
        order.verify(versionTasks).insertBatch(WS, "V1", Collections.singletonList("T1"));
        order.verify(tasks).touchDeliveryRevision(WS, "T1");
        order.verify(taskAudit).logChange(USER, WS, "T1", "version_change", "调整规划版本",
                Collections.singletonMap("versionIds", Collections.emptyList()),
                Collections.singletonMap("versionIds", Collections.singletonList("V1")), "调整交付范围");
        order.verify(lock).lockTask(WS, "T2");
        order.verify(versionTasks).deleteBinding(WS, "T2", "V1");
        order.verify(tasks).touchDeliveryRevision(WS, "T2");
        order.verify(taskAudit).logChange(USER, WS, "T2", "version_change", "调整规划版本",
                Collections.singletonMap("versionIds", Arrays.asList("V1", "V2")),
                Collections.singletonMap("versionIds", Collections.singletonList("V2")), "调整交付范围");
        order.verify(lock).lockTask(WS, "T3");
        order.verify(versionTasks).insertBatch(WS, "V1", Collections.singletonList("T3"));
        order.verify(tasks).touchDeliveryRevision(WS, "T3");
        verify(taskAudit).logChange(USER, WS, "T3", "version_change", "调整规划版本",
                Collections.singletonMap("versionIds", Collections.singletonList("V2")),
                Collections.singletonMap("versionIds", Arrays.asList("V1", "V2")), "调整交付范围");
        verify(versionTasks, never()).deleteByTaskId(anyString(), anyString());
        verify(versionTasks, never()).deleteBinding(WS, "T3", "V2");
        verify(permissions, never()).assertPublishTaskForUpdate(anyString(), anyString(), any());
        verify(versionTasks).insertBatch(WS, "V1", Collections.singletonList("T3"));
        verify(versionTasks, never()).insertBatch(eq(WS), anyString(), eq(Collections.singletonList("T2")));
        verify(tasks, times(3)).touchDeliveryRevision(eq(WS), anyString());
        verify(tasks, never()).update(any(Task.class));
        verify(lock, never()).lockTask(WS, "T4");
        verify(lock, never()).lockTask(WS, "T5");
        assertEquals(Collections.singletonList("V2"), move.getVersionIds());
        assertEquals(LocalDate.of(2026, 11, 9), move.getPublishedAt());
        verify(versionTasks, never()).deleteBinding(WS, "T2", "V2");
        assertEquals("保留描述", move.getDescription());
        assertEquals("doing", move.getBoardColumn());
        assertEquals(45, move.getProgress());
        assertEquals(LocalDate.of(2026, 11, 9), move.getStartDate());
        assertEquals(LocalDate.of(2026, 11, 12), move.getDueDate());
        assertEquals(LocalDateTime.of(2026, 11, 9, 12, 0), move.getUpdatedAt());
    }

    @Test
    void unchangedTaskSelectionNeedsNoReasonAndDoesNotTouchLinks() {
        mockVersion(version("V1", "R1"));
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1"))
                .thenReturn(Collections.singletonList(task("T1", "V1", USER)));
        ProjectVersionSaveRequest request = updateRequest();
        request.setTaskIds(Collections.singletonList("T1"));
        service.update(USER, WS, "V1", request);
        verify(lock, never()).lockTask(anyString(), anyString());
        verifyNoInteractions(permissions);
        verify(tasks).selectTaskVersionsForScope(WS, "T1");
        verify(tasks, never()).touchDeliveryRevision(anyString(), anyString());
        verify(versionTasks, never()).deleteByTaskId(anyString(), anyString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"formal-success", "permission", "moved-project", "deleted"})
    void batchChangesRejectFormalSuccessCurrentPermissionDenialAndConcurrentMoves(String state) {
        mockVersion(version("V1", "R1"));
        Task current = task("T1", null, USER);
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1")).thenReturn(Collections.singletonList(current));
        when(lock.lockTask(WS, "T1")).thenReturn(current);
        int code = 409;
        if ("formal-success".equals(state)) {
            when(tasks.selectVersionFormalSuccessIdsForScope(WS, "V1")).thenReturn(Collections.singletonList("VR1"));
            code = 400;
        }
        if ("permission".equals(state)) {
            doThrow(new AppException(403, "只读项目")).when(permissions).assertManageProjectForUpdate(USER, WS, "R1");
            code = 403;
        }
        if ("moved-project".equals(state)) current.setReqId("R2");
        if ("deleted".equals(state)) current.setDeletedAt(java.time.LocalDateTime.now());
        ProjectVersionSaveRequest request = updateRequest();
        request.setTaskIds(Collections.singletonList("T1"));
        request.setTaskChangeReason("调整范围");
        assertEquals(code, assertThrows(AppException.class,
                () -> service.update(USER, WS, "V1", request)).getCode());
        verify(versionTasks, never()).deleteByTaskId(anyString(), anyString());
        verify(versionTasks, never()).insertBatch(anyString(), anyString(), anyList());
        verifyNoInteractions(releaseService, taskAudit);
        verify(tasks, never()).touchDeliveryRevision(anyString(), anyString());
        verify(tasks, never()).update(any(Task.class));
    }

    @Test
    void versionDeleteIsProtectedByAnyReleaseAttemptIncludingFailure() {
        mockVersion(version("V1", "R1"));
        VersionRelease failed = new VersionRelease();
        failed.setResult("failed");
        when(releases.selectRecordsForUpdate(WS, "V1")).thenReturn(Collections.singletonList(failed));
        assertEquals(422, assertThrows(AppException.class, () -> service.delete(USER, WS, "V1")).getCode());
        verify(versions, never()).deleteById(anyString(), anyString());
        verify(versionTasks, never()).deleteByVersion(anyString(), anyString());
        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
        assertDeleteDidNotMutate();
    }

    @Test
    void versionContainingPublishedTaskCannotBeDeleted() {
        mockVersion(version("V1", "R1"));
        Task published = task("T1", "V1", USER);
        published.setPublishedAt(LocalDate.now());
        when(releases.selectAllTasksByProjectForUpdate(WS, "R1")).thenReturn(Collections.singletonList(published));
        AppException error = assertThrows(AppException.class, () -> service.delete(USER, WS, "V1"));
        assertEquals(422, error.getCode());
        assertTrue(error.getMessage().contains("填写原因"));
        assertDeleteDidNotMutate();
    }

    @ParameterizedTest
    @ValueSource(strings = {"success", "failed"})
    void projectDeletionIsProtectedByAnyFormalReleaseAttempt(String result) {
        VersionRelease record = new VersionRelease();
        record.setResult(result);
        when(releases.selectRecordsByProjectForUpdate(WS, "R1")).thenReturn(Collections.singletonList(record));
        assertEquals(422, assertThrows(AppException.class, () -> service.deleteByReq(WS, "R1")).getCode());
        verify(lock).lockProjects(WS, "R1");
        verify(versions, never()).deleteByReq(anyString(), anyString());
        verify(versionTasks, never()).deleteByReq(anyString(), anyString());
        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"plan", "audit"})
    void versionAndProjectDeletionPreservePlanAndAuditHistory(String history) {
        mockVersion(version("V1", "R1"));
        when(versions.selectByReqForUpdate(WS, "R1")).thenReturn(Collections.singletonList(version("V1", "R1")));
        if ("plan".equals(history)) when(tasks.selectVersionPlanIdsForScope(WS, "V1"))
                .thenReturn(Collections.singletonList("PLAN-1"));
        else when(tasks.selectVersionAuditIdsForScope(WS, "V1")).thenReturn(Collections.singletonList(1L));
        assertEquals(422, assertThrows(AppException.class, () -> service.delete(USER, WS, "V1")).getCode());
        assertEquals(422, assertThrows(AppException.class, () -> service.deleteByReq(WS, "R1")).getCode());
        verify(versions, never()).deleteById(anyString(), anyString());
        verify(versions, never()).deleteByReq(anyString(), anyString());
        verify(versionTasks, never()).deleteByReq(anyString(), anyString());
        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
    }

    @Test
    void unrecordedProjectDeletionChecksHistoryWithoutErasingPlans() {
        when(versions.selectByReqForUpdate(WS, "R1")).thenReturn(Collections.singletonList(version("V1", "R1")));
        service.deleteByReq(WS, "R1");
        InOrder order = inOrder(lock, releases, versionTasks, versions);
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(releases).selectRecordsByProjectForUpdate(WS, "R1");
        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
        verify(tasks, times(2)).selectVersionPlanIdsForScope(WS, "V1");
        verify(tasks, times(2)).selectVersionAuditIdsForScope(WS, "V1");
        order.verify(versionTasks).deleteByReq(WS, "R1");
        order.verify(versions).deleteByReq(WS, "R1");
    }

    @Test
    void invalidDateWindowAndCrossWorkspaceVersionAreRejected() {
        mockVersion(version("V1", "R1"));
        ProjectVersionSaveRequest request = updateRequest();
        request.setStartDate(LocalDate.now().plusDays(1));
        request.setTargetDate(LocalDate.now());
        assertEquals(400, assertThrows(AppException.class,
                () -> service.update(USER, WS, "V1", request)).getCode());
        ProjectVersion foreign = version("V2", "R1");
        foreign.setWorkspaceId("W2");
        when(versions.selectById("V2")).thenReturn(foreign);
        assertEquals(404, assertThrows(AppException.class, () -> service.start(USER, WS, "V2")).getCode());
        verify(versions, never()).update(any());
    }

    @ParameterizedTest
    @CsvSource({"create,403", "update,403", "start,403", "delete,403",
            "create,404", "update,404", "start,404", "delete,404"})
    void currentWritePermissionDenialStopsAllVersionWritesAfterProjectMutex(String operation, int code) {
        mockVersion(version("V1", "R1"));
        when(reqs.selectById("R1")).thenReturn(requirement("R1"));
        doThrow(new AppException(code, "权限已变化")).when(access).assertWriteForUpdate(WS, USER, "R1");

        AppException failure = assertThrows(AppException.class, () -> {
            if ("create".equals(operation)) service.create(USER, WS, updateRequest());
            else if ("update".equals(operation)) service.update(USER, WS, "V1", updateRequest());
            else if ("start".equals(operation)) service.start(USER, WS, "V1");
            else service.delete(USER, WS, "V1");
        });

        assertEquals(code, failure.getCode());
        InOrder order = inOrder(lock, versions, access);
        order.verify(lock).lockProjects(WS, "R1");
        if (!"create".equals(operation)) order.verify(versions).selectByIdForUpdate(WS, "V1");
        order.verify(access).assertWriteForUpdate(WS, USER, "R1");
        verify(versions, never()).insert(any());
        verify(versions, never()).update(any());
        verify(versions, never()).deleteById(anyString(), anyString());
        verifyNoInteractions(releases, versionTasks, tasks, releaseService, permissions);
    }

    @ParameterizedTest
    @ValueSource(strings = {"start", "update", "delete"})
    void committedReleasedVersionOverridesInitialSnapshotAfterMutex(String operation) {
        ProjectVersion initial = version("V1", "R1");
        mockVersion(initial);
        ProjectVersion committed = version("V1", "R1");
        committed.setStatus("released");
        when(versions.selectByIdForUpdate(WS, "V1")).thenReturn(committed);

        assertEquals("delete".equals(operation) ? 422 : 400, assertThrows(AppException.class, () -> {
            if ("start".equals(operation)) service.start(USER, WS, "V1");
            else if ("update".equals(operation)) service.update(USER, WS, "V1", updateRequest());
            else service.delete(USER, WS, "V1");
        }).getCode());

        InOrder order = inOrder(versions, lock);
        order.verify(versions).selectById("V1");
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(versions).selectByIdForUpdate(WS, "V1");
        verify(versions, times(1)).selectById("V1");
        verify(versions, never()).update(any());
        verify(versions, never()).deleteById(anyString(), anyString());
        assertEquals("active", initial.getStatus());
    }

    @Test
    void committedRevisionRejectsUpdateEvenWhenInitialSnapshotMatchesRequest() {
        mockVersion(version("V1", "R1"));
        ProjectVersion committed = version("V1", "R1");
        committed.setRevision(1L);
        when(versions.selectByIdForUpdate(WS, "V1")).thenReturn(committed);

        assertEquals(409, assertThrows(AppException.class,
                () -> service.update(USER, WS, "V1", updateRequest())).getCode());
        verify(versions, never()).update(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"version", "project"})
    void deletedPublishedTaskStillProtectsVersionAndProjectDeletion(String scope) {
        mockVersion(version("V1", "R1"));
        Task trashed = task("T-trash", "version".equals(scope) ? "V1" : null, USER);
        trashed.setDeletedAt(java.time.LocalDateTime.now());
        trashed.setPublishedAt(LocalDate.now());
        when(releases.selectAllTasksByProjectForUpdate(WS, "R1")).thenReturn(Collections.singletonList(trashed));
        if ("project".equals(scope)) {
            VersionRelease record = new VersionRelease();
            record.setResult("success");
            when(releases.selectRecordsByProjectForUpdate(WS, "R1")).thenReturn(Collections.singletonList(record));
        }
        // Active options cannot establish deletion safety for trashed references.
        when(versionTasks.selectOptionsByReq(WS, "R1")).thenReturn(Collections.emptyList());

        assertEquals(422, assertThrows(AppException.class, () -> {
            if ("version".equals(scope)) service.delete(USER, WS, "V1");
            else service.deleteByReq(WS, "R1");
        }).getCode());

        InOrder order = inOrder(lock, releases);
        order.verify(lock).lockProjects(WS, "R1");
        if ("version".equals(scope)) order.verify(releases).selectAllTasksByProjectForUpdate(WS, "R1");
        else order.verify(releases).selectRecordsByProjectForUpdate(WS, "R1");
        verify(versionTasks, never()).selectOptionsByReq(anyString(), anyString());
        verify(versions, never()).deleteById(anyString(), anyString());
        verify(versions, never()).deleteByReq(anyString(), anyString());
    }

    @Test
    void batchEnumeratesCommittedBindingMissingFromOldSnapshotAndDetachesIt() {
        mockVersion(version("V1", "R1"));
        Task committed = task("T-new-binding", "V1", USER);
        when(versionTasks.selectOptionsByReq(WS, "R1")).thenReturn(Collections.emptyList());
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1")).thenReturn(Collections.singletonList(committed));
        when(lock.lockTask(WS, committed.getId())).thenReturn(committed);
        ProjectVersionSaveRequest request = updateRequest();
        request.setTaskIds(Collections.emptyList());
        request.setTaskChangeReason("移除刚提交的绑定");

        service.update(USER, WS, "V1", request);

        InOrder order = inOrder(lock, releases, versionTasks);
        order.verify(lock).lockProjects(WS, "R1");
        order.verify(releases).selectActiveTasksByProjectForUpdate(WS, "R1");
        order.verify(lock).lockTask(WS, committed.getId());
        order.verify(versionTasks).deleteBinding(WS, committed.getId(), "V1");
        verify(versionTasks, never()).deleteByTaskId(anyString(), anyString());
        verify(versionTasks, never()).selectOptionsByReq(anyString(), anyString());
        verify(taskAudit).logChange(USER, WS, committed.getId(), "version_change", "调整规划版本",
                Collections.singletonMap("versionIds", Collections.singletonList("V1")),
                Collections.singletonMap("versionIds", Collections.emptyList()), "移除刚提交的绑定");
        verify(tasks).touchDeliveryRevision(WS, committed.getId());
        verify(tasks, never()).update(any(Task.class));
    }

    @Test
    void failedRevisionTouchRejectsScopeChangeBeforeSuccessHistory() {
        mockVersion(version("V1", "R1"));
        Task task = task("T1", null, USER);
        when(releases.selectActiveTasksByProjectForUpdate(WS, "R1"))
                .thenReturn(Collections.singletonList(task));
        when(lock.lockTask(WS, "T1")).thenReturn(task);
        when(tasks.touchDeliveryRevision(WS, "T1")).thenReturn(0);
        ProjectVersionSaveRequest request = updateRequest();
        request.setTaskIds(Collections.singletonList("T1"));
        request.setTaskChangeReason("调整范围");

        assertEquals(409, assertThrows(AppException.class,
                () -> service.update(USER, WS, "V1", request)).getCode());

        verify(tasks).touchDeliveryRevision(WS, "T1");
        verify(tasks, never()).update(any(Task.class));
        verify(releaseService, never()).log(anyString(), anyString(), anyString(), anyString(), any(), any(), any());
    }

    @Test
    void mapperTouchStrictlyAdvancesSecondPrecisionRevisionAndOnlyWritesTimestamp() throws Exception {
        Configuration configuration = mapperConfiguration();
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("workspaceId", WS);
        params.put("taskId", "T1");
        MappedStatement statement = configuration.getMappedStatement("com.hourglass.mapper.TaskMapper.touchDeliveryRevision");
        BoundSql bound = statement.getBoundSql(params);

        // NOW alone can repeat in one second; old + 1 second also advances revisions ahead of wall time.
        assertEquals("UPDATE task SET updated_at = GREATEST(NOW(), DATE_ADD(updated_at, INTERVAL 1 SECOND)) "
                + "WHERE workspace_id = ? AND id = ?", bound.getSql().replaceAll("\\s+", " ").trim());
        assertEquals(Arrays.asList("workspaceId", "taskId"), bound.getParameterMappings().stream()
                .map(mapping -> mapping.getProperty()).collect(Collectors.toList()));
        assertTrue(statement.isFlushCacheRequired());
        assertNotNull(TaskMapper.class.getMethod("touchDeliveryRevision", String.class, String.class));
    }

    @Test
    void mapperDrawerCasUsesOriginalTimestampSoRevisionTouchInvalidatesStaleSave() throws Exception {
        Configuration configuration = mapperConfiguration();
        MappedStatement statement = configuration.getMappedStatement("com.hourglass.mapper.TaskMapper.update");
        Task drawer = task("T1", "V1", USER);
        LocalDateTime oldUpdatedAt = LocalDateTime.of(2026, 11, 9, 12, 0);
        drawer.setUpdatedAt(oldUpdatedAt);
        drawer.setVersionCheck(true);
        BoundSql bound = statement.getBoundSql(drawer);

        assertTrue(bound.getSql().contains("updated_at = GREATEST(NOW(), DATE_ADD(updated_at, INTERVAL 1 SECOND))"));
        assertTrue(bound.getSql().replaceAll("\\s+", " ").trim().endsWith("WHERE id = ? AND updated_at = ?"));
        assertEquals("updatedAt", bound.getParameterMappings().get(bound.getParameterMappings().size() - 1).getProperty());
        assertEquals(oldUpdatedAt, configuration.newMetaObject(bound.getParameterObject()).getValue("updatedAt"));
        for (Boolean versionCheck : Arrays.asList(false, null)) {
            drawer.setVersionCheck(versionCheck);
            assertFalse(statement.getBoundSql(drawer).getSql().contains("AND updated_at ="));
        }
    }

    @Test
    void deletionMapperGuardsUseUnfilteredProjectCurrentReads() throws Exception {
        Configuration configuration = mapperConfiguration();
        for (String name : Arrays.asList("selectAllTasksByProjectForUpdate", "selectDemandsByProjectForUpdate")) {
            MappedStatement statement = configuration.getMappedStatement("com.hourglass.mapper.ReleaseMapper." + name);
            String sql = statement.getBoundSql(Collections.emptyMap()).getSql().replaceAll("\\s+", " ").trim();
            assertTrue(sql.endsWith("FOR UPDATE"), name);
            assertTrue(sql.contains("workspace_id = ?"), name);
            assertTrue(sql.contains("req_id = ?"), name);
            assertFalse(sql.contains("deleted_at IS NULL"), name);
            assertFalse(sql.contains("status ="), name);
            assertFalse(statement.isUseCache(), name);
            assertTrue(statement.isFlushCacheRequired(), name);
        }
    }

    private Configuration mapperConfiguration() throws Exception {
        Configuration configuration = new Configuration();
        configuration.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        configuration.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        for (String resource : Arrays.asList("mapper/TaskMapper.xml", "mapper/ReleaseMapper.xml")) {
            try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
                assertNotNull(input);
                new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
            }
        }
        return configuration;
    }

    private void assertDeleteDidNotMutate() {
        verify(versions, never()).deleteById(anyString(), anyString());
        verify(versions, never()).update(any(ProjectVersion.class));
        verify(releases, never()).deletePlansByVersion(anyString(), anyString());
        verifyNoInteractions(versionTasks, releaseService);
        verify(tasks, never()).update(any(Task.class));
        verify(tasks, never()).touchDeliveryRevision(anyString(), anyString());
    }

    private void mockVersion(ProjectVersion version) {
        when(versions.selectById(version.getId())).thenReturn(version);
        when(versions.selectByIdForUpdate(WS, version.getId())).thenReturn(version);
    }

    private ProjectVersionSaveRequest updateRequest() {
        ProjectVersionSaveRequest request = new ProjectVersionSaveRequest();
        request.setReqId("R1");
        request.setName("V1");
        request.setRevision(0L);
        request.setStatus("active");
        return request;
    }

    private ProjectVersion version(String id, String reqId) {
        ProjectVersion v = new ProjectVersion();
        v.setId(id);
        v.setWorkspaceId(WS);
        v.setReqId(reqId);
        v.setName(id);
        v.setStatus("active");
        v.setRevision(0L);
        return v;
    }

    private Requirement requirement(String id) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setName("项目");
        return r;
    }

    private Task task(String id, String versionId, String ownerUserId) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId("R1");
        t.setTitle(id);
        t.setVersionIds(versionId == null ? Collections.emptyList() : Collections.singletonList(versionId));
        taskBindings.put(id, new ArrayList<>(t.getVersionIds()));
        t.setOwnerUserId(ownerUserId);
        return t;
    }
}
