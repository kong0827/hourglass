package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.dto.DemandActionRequest;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.io.InputStream;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DemandServiceScheduleTest {
    private final DemandMapper demands = mock(DemandMapper.class);
    private final RequirementMapper projects = mock(RequirementMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final DeliveryScopeLock lock = mock(DeliveryScopeLock.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final com.hourglass.mapper.RequirementDocMapper docs = mock(com.hourglass.mapper.RequirementDocMapper.class);
    private final AttachmentService attachments = mock(AttachmentService.class);
    private final com.hourglass.mapper.MailDeliveryMapper mail = mock(com.hourglass.mapper.MailDeliveryMapper.class);
    private final com.hourglass.mapper.TestCaseMapper cases = mock(com.hourglass.mapper.TestCaseMapper.class);
    private final DeletionTraceService deletionTrace = mock(DeletionTraceService.class);
    private final DemandService service = new DemandService(demands, projects, versions, tasks, events,
            docs, access, attachments, mail, cases,
            mock(com.hourglass.mapper.CategoryMapper.class), lock, permissions,
            deletionTrace);
    private final com.hourglass.mapper.ReleaseMapper releases = mock(com.hourglass.mapper.ReleaseMapper.class);
    private final com.hourglass.mapper.VersionTaskMapper bindings = mock(com.hourglass.mapper.VersionTaskMapper.class);
    private final TaskPublicationService publications = new TaskPublicationService(tasks, releases,
            mock(com.hourglass.mapper.TaskLogMapper.class), lock, permissions, new ObjectMapper());
    private Demand demand;
    private ProjectVersion version;

    @BeforeEach
    void setup() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "releases", releases);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "versionTaskMapper", bindings);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", publications);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "judgementMapper",
                mock(com.hourglass.mapper.DemandDeliveryJudgementMapper.class));
        lenient().when(demands.selectDetail(any(), anyString()))
                .thenAnswer(inv -> demands.selectById(inv.getArgument(1)));
        doCallRealMethod().when(bindings).enrichTasks(anyString(), anyList());
        demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId("W1");
        demand.setReqId("R1");
        demand.setTitle("需求");
        demand.setStatus("pass");
        demand.setPriority("P2");
        demand.setRevision(4L);
        demand.setExpectDate(LocalDate.of(2026, 12, 20));
        when(demands.selectById("D1")).thenReturn(demand);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(demand);
        when(demands.update(any(Demand.class))).thenReturn(1);
        when(permissions.canManageProject("U1", "W1", "R1")).thenReturn(true);
        version = new ProjectVersion();
        version.setId("V1");
        version.setWorkspaceId("W1");
        version.setReqId("R1");
        version.setName("1.0");
        version.setStatus("planning");
        when(versions.selectById("V1")).thenReturn(version);
        when(demands.selectScheduleVersion("W1", "R1", "V1")).thenReturn(version);
        Requirement project = new Requirement();
        project.setId("R1");
        project.setWorkspaceId("W1");
        when(projects.selectById("R1")).thenReturn(project);
    }

    private DemandActionRequest action(String reason) {
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setVersionId("V1");
        body.setNote(reason);
        return body;
    }

    @Test
    void initialPlanAllowsNoReasonAndEmptyDates() throws Exception {
        Demand result = service.plan("U1", "W1", "D1", action(null));
        assertEquals("plan", result.getStatus());
        assertEquals("V1", result.getVersionId());
        assertEquals(5L, result.getRevision());
        assertEquals(true, result.getCanSchedule());
        assertNull(result.getPlannedStart());
        assertEquals(LocalDate.of(2026, 12, 20), result.getExpectDate());
        JsonNode log = changeLog("plan");
        assertEquals("pass", log.path("before").path("status").asText());
        assertEquals(4, log.path("before").path("revision").asInt());
        assertEquals("1.0", log.path("after").path("versionName").asText());
        assertEquals(5, log.path("after").path("revision").asInt());
        assertTrue(log.path("reason").isNull());
        InOrder ordered = inOrder(permissions, lock, demands);
        ordered.verify(demands).selectById("D1");
        ordered.verify(permissions).assertManageProject("U1", "W1", "R1");
        ordered.verify(lock).lockProjects("W1", "R1");
        ordered.verify(demands).selectByIdForUpdate("W1", "D1");
        ordered.verify(permissions).assertManageProjectForUpdate("U1", "W1", "R1");
        ordered.verify(demands).update(any());
        verifyNoInteractions(tasks);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"  \t "})
    void initialPlanWithoutTargetKeepsDatesAndStructuredHistory(String versionId) throws Exception {
        demand.setCreatedBy("U-submit");
        DemandActionRequest body = action(null);
        body.setVersionId(versionId);
        body.setPlannedStart(LocalDate.of(2026, 12, 1));
        body.setPlannedEnd(LocalDate.of(2026, 12, 10));

        Demand result = service.plan("U1", "W1", "D1", body);

        assertEquals("plan", result.getStatus());
        assertNull(result.getVersionId());
        assertNull(result.getVersionName());
        assertEquals(5L, result.getRevision());
        assertEquals(body.getPlannedStart(), result.getPlannedStart());
        assertEquals(body.getPlannedEnd(), result.getPlannedEnd());
        assertEquals("P2", result.getPriority());
        assertEquals(LocalDate.of(2026, 12, 20), result.getExpectDate());
        JsonNode log = changeLog("plan");
        assertEquals("pass", log.path("before").path("status").asText());
        assertEquals(4, log.path("before").path("revision").asInt());
        assertTrue(log.path("before").path("versionId").isNull());
        assertTrue(log.path("before").path("versionName").isNull());
        assertTrue(log.path("before").path("plannedStart").isNull());
        assertEquals("plan", log.path("after").path("status").asText());
        assertEquals(5, log.path("after").path("revision").asInt());
        assertTrue(log.path("after").path("versionId").isNull());
        assertTrue(log.path("after").path("versionName").isNull());
        assertEquals("2026-12-01", log.path("after").path("plannedStart").asText());
        assertEquals("2026-12-10", log.path("after").path("plannedEnd").asText());
        assertTrue(log.path("reason").isNull());
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("plan"),
                eq("已排期，目标未指定"), eq("U1"), anyString());
        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「需求」已排期"), eq("目标未指定"), eq("demand"), eq("D1"), eq("R1"));
        verify(demands, never()).selectScheduleVersion(any(), any(), any());
        verifyNoInteractions(versions, tasks);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"  \t "})
    void replanCanClearTargetWithoutVersionQuery(String versionId) throws Exception {
        planned();
        demand.setCreatedBy("U-submit");
        DemandActionRequest body = action("目标待定");
        body.setVersionId(versionId);
        body.setPlannedStart(demand.getPlannedStart());
        body.setPlannedEnd(demand.getPlannedEnd());

        Demand result = service.replan("U1", "W1", "D1", body);

        assertEquals("plan", result.getStatus());
        assertNull(result.getVersionId());
        assertNull(result.getVersionName());
        assertEquals(5L, result.getRevision());
        assertEquals(body.getPlannedStart(), result.getPlannedStart());
        assertEquals(body.getPlannedEnd(), result.getPlannedEnd());
        assertEquals("目标待定", result.getReviewNote());
        assertEquals("P2", result.getPriority());
        assertEquals(LocalDate.of(2026, 12, 20), result.getExpectDate());
        JsonNode log = changeLog("replan");
        assertEquals("V-old", log.path("before").path("versionId").asText());
        assertEquals("Old", log.path("before").path("versionName").asText());
        assertEquals("plan", log.path("before").path("status").asText());
        assertEquals(4, log.path("before").path("revision").asInt());
        assertTrue(log.path("after").path("versionId").isNull());
        assertTrue(log.path("after").path("versionName").isNull());
        assertEquals("plan", log.path("after").path("status").asText());
        assertEquals(5, log.path("after").path("revision").asInt());
        assertEquals(log.path("before").path("plannedStart"), log.path("after").path("plannedStart"));
        assertEquals(log.path("before").path("plannedEnd"), log.path("after").path("plannedEnd"));
        assertEquals("目标待定", log.path("reason").asText());
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("replan"),
                eq("调整排期，目标未指定：目标待定"), eq("U1"), anyString());
        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「需求」已调期"), eq("目标未指定；目标待定"), eq("demand"), eq("D1"), eq("R1"));
        verify(demands, never()).selectScheduleVersion(any(), any(), any());
        verifyNoInteractions(versions, tasks);
    }

    @ParameterizedTest
    @ValueSource(strings = {"workspace", "project", "released", "releasedAt"})
    void rejectsInvalidTargetVersion(String condition) {
        if ("workspace".equals(condition)) version.setWorkspaceId("W2");
        if ("project".equals(condition)) version.setReqId("R2");
        if ("released".equals(condition)) version.setStatus("released");
        if ("releasedAt".equals(condition)) version.setReleasedAt(LocalDateTime.now());
        assertEquals(400, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verify(demands, never()).update(any());
        verifyNoInteractions(tasks);
    }

    @Test
    void rejectsMissingAndStaleRevisionBeforeMutation() {
        DemandActionRequest body = action(null);
        body.setRevision(null);
        assertEquals(400, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", body)).getCode());
        body.setRevision(3L);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).update(any());
        assertEquals("pass", demand.getStatus());
    }

    @Test
    void currentReadAfterProjectLockDetectsChangeWhileWaiting() {
        Demand current = new Demand();
        current.setId("D1");
        current.setWorkspaceId("W1");
        current.setReqId("R1");
        current.setStatus("pass");
        current.setRevision(5L);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(current);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verify(demands, never()).update(any());
    }

    @Test
    void oldSnapshotOfVersionCannotOverrideReleasedCurrentRead() {
        ProjectVersion released = new ProjectVersion();
        released.setId("V1");
        released.setWorkspaceId("W1");
        released.setReqId("R1");
        released.setStatus("released");
        when(demands.selectScheduleVersion("W1", "R1", "V1")).thenReturn(released);
        assertEquals(400, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verify(demands, never()).update(any());
    }

    @Test
    void zeroAffectedRowsIsConflictWithoutLogOrNotification() {
        when(demands.update(any())).thenReturn(0);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), any(), anyString(), anyString());
        verifyNoInteractions(events, tasks);
    }

    @Test
    void managePermissionIsRequiredBeforeLockAndUpdate() {
        doThrow(new AppException(403, "forbidden")).when(permissions).assertManageProject("U1", "W1", "R1");
        assertEquals(403, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verifyNoInteractions(lock, tasks);
        verify(demands, never()).update(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"plan", "replan", "unplan", "cancel", "restore"})
    void currentManagePermissionDenialAfterProjectAndDemandLocksPreventsScheduling(String operation) {
        doThrow(new AppException(403, "权限已变化"))
                .when(permissions).assertManageProjectForUpdate("U1", "W1", "R1");
        assertEquals(403, assertThrows(AppException.class,
                () -> performSchedule(operation, action("调整"))).getCode());
        InOrder order = inOrder(permissions, lock, demands);
        order.verify(permissions).assertManageProject("U1", "W1", "R1");
        order.verify(lock).lockProjects("W1", "R1");
        order.verify(demands).selectByIdForUpdate("W1", "D1");
        order.verify(permissions).assertManageProjectForUpdate("U1", "W1", "R1");
        verify(demands, never()).update(any());
        verifyNoInteractions(tasks, events);
    }

    @Test
    void changedProjectIsRejectedBeforePermissionSnapshotCouldLockAnUnheldProject() {
        Demand moved = new Demand();
        moved.setWorkspaceId("W1");
        moved.setReqId("R2");
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(moved);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verify(permissions, never()).assertManageProjectForUpdate(anyString(), anyString(), anyString());
        verify(demands, never()).update(any());
    }

    private Demand performSchedule(String operation, DemandActionRequest body) {
        return "plan".equals(operation) ? service.plan("U1", "W1", "D1", body) : perform(operation, body);
    }

    @Test
    void invisibleProjectNeverReachesManageOrLock() {
        doThrow(AppException.notFound("hidden")).when(access).assertView("W1", "U1", "R1");
        assertEquals(404, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", action(null))).getCode());
        verify(permissions, never()).assertManageProject(anyString(), anyString(), anyString());
        verifyNoInteractions(lock, tasks);
    }

    @Test
    void replanPreservesStatusAndDoesNotChangeTaskSchedule() throws Exception {
        planned();
        DemandActionRequest body = action("调整交付节奏");
        body.setPriority("P0");
        body.setPlannedStart(LocalDate.of(2027, 1, 1));
        body.setPlannedEnd(LocalDate.of(2027, 1, 10));
        Demand result = service.replan("U1", "W1", "D1", body);
        assertEquals("plan", result.getStatus());
        assertEquals("P0", result.getPriority());
        assertEquals(body.getPlannedEnd(), result.getPlannedEnd());
        assertEquals(LocalDate.of(2026, 12, 20), result.getExpectDate());
        JsonNode log = changeLog("replan");
        assertEquals("Old", log.path("before").path("versionName").asText());
        assertEquals("V-old", log.path("before").path("versionId").asText());
        assertEquals("P2", log.path("before").path("priority").asText());
        assertEquals("2027-01-10", log.path("after").path("plannedEnd").asText());
        assertEquals("调整交付节奏", log.path("reason").asText());
        verifyNoInteractions(tasks);
    }

    @Test
    void replanCanClearDates() {
        planned();
        Demand result = service.replan("U1", "W1", "D1", action("移除暂定时间"));
        assertNull(result.getPlannedStart());
        assertNull(result.getPlannedEnd());
        verifyNoInteractions(tasks);
    }

    @Test
    void rejectsReverseDatesAndInvalidPriority() {
        DemandActionRequest body = action(null);
        body.setPlannedStart(LocalDate.of(2027, 1, 10));
        body.setPlannedEnd(LocalDate.of(2027, 1, 1));
        assertEquals(400, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", body)).getCode());
        body.setPlannedEnd(null);
        body.setPriority("P9");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.plan("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).update(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"replan", "unplan", "cancel", "restore"})
    void scheduleChangesRequireReason(String action) {
        planned();
        if ("restore".equals(action)) demand.setStatus("closed");
        assertEquals(400, assertThrows(AppException.class, () -> perform(action, action("  "))).getCode());
        verify(demands, never()).update(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"review", "pass", "plan", "rej"})
    void cancelAndRestoreDoNotModifyTasks(String status) throws Exception {
        planned();
        demand.setStatus(status);
        Demand closed = service.cancel("U1", "W1", "D1", action("范围取消"));
        assertEquals("closed", closed.getStatus());
        assertEquals("cancel", closed.getCloseReason());
        assertEquals("rej".equals(status) ? "review" : status, closed.getCloseStage());
        assertEquals("V-old", closed.getVersionId());
        JsonNode cancelLog = changeLog("cancel");
        assertEquals(status, cancelLog.path("before").path("status").asText());
        assertEquals("closed", cancelLog.path("after").path("status").asText());
        assertEquals("cancel", cancelLog.path("after").path("closeReason").asText());
        DemandActionRequest restore = action("重新纳入计划");
        restore.setRevision(5L);
        Demand restored = service.restore("U1", "W1", "D1", restore);
        String expected = "review".equals(status) || "rej".equals(status) ? "review" : "pass";
        assertEquals(expected, restored.getStatus());
        assertNull(restored.getCloseReason());
        assertNull(restored.getCloseStage());
        assertEquals(6L, restored.getRevision());
        if ("pass".equals(expected)) {
            assertNull(restored.getVersionId());
            assertNull(restored.getVersionName());
            assertNull(restored.getPlannedStart());
            assertNull(restored.getPlannedEnd());
        }
        assertEquals(LocalDate.of(2026, 12, 20), restored.getExpectDate());
        verifyNoInteractions(tasks);
    }

    @Test
    void unplanClearsTargetAndKeepsHistoricalTargetInLog() throws Exception {
        planned();
        service.unplan("U1", "W1", "D1", action("撤排"));
        assertEquals("pass", demand.getStatus());
        assertNull(demand.getVersionId());
        assertNull(demand.getPlannedStart());
        JsonNode log = changeLog("unplan");
        assertEquals("V-old", log.path("before").path("versionId").asText());
        assertEquals("Old", log.path("before").path("versionName").asText());
        assertTrue(log.path("after").path("versionId").isNull());
        verifyNoInteractions(tasks);
    }

    @Test
    void closedCannotPlanReplanOrCancelAgain() {
        demand.setStatus("closed");
        assertThrows(AppException.class, () -> service.plan("U1", "W1", "D1", action("reason")));
        assertThrows(AppException.class, () -> service.replan("U1", "W1", "D1", action("reason")));
        assertThrows(AppException.class, () -> service.cancel("U1", "W1", "D1", action("reason")));
        verify(demands, never()).update(any());
    }

    @Test
    void ordinaryUpdateRequiresRevisionAndIncrementsIt() {
        demand.setStatus("review");
        DemandSaveRequest body = new DemandSaveRequest();
        body.setReqId("R1");
        body.setTitle("修改需求");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.update("U1", "W1", "D1", body)).getCode());
        body.setRevision(3L);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.update("U1", "W1", "D1", body)).getCode());
        body.setRevision(4L);
        assertEquals(5L, service.update("U1", "W1", "D1", body).getRevision());
    }

    @ParameterizedTest
    @ValueSource(ints = {403, 404})
    void ordinaryUpdateRevalidatesWritePermissionAfterProjectAndDemandLocks(int code) {
        demand.setStatus("review");
        DemandSaveRequest body = new DemandSaveRequest();
        body.setReqId("R1");
        body.setTitle("修改需求");
        body.setRevision(4L);
        doThrow(new AppException(code, "权限已变化"))
                .when(access).assertWriteForUpdate("W1", "U1", "R1");

        assertEquals(code, assertThrows(AppException.class,
                () -> service.update("U1", "W1", "D1", body)).getCode());

        InOrder order = inOrder(lock, demands, access);
        order.verify(access).assertWrite("W1", "U1", "R1");
        order.verify(lock).lockProjects("W1", "R1");
        order.verify(demands).selectByIdForUpdate("W1", "D1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        verify(demands, never()).update(any());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), any(), anyString(), anyString());
        verifyNoInteractions(events);
    }

    @Test
    void legacyReviewStillUsesSqlCasAndRejectsStaleProvidedRevision() {
        demand.setStatus("review");
        DemandActionRequest body = action(null);
        body.setRevision(3L);
        assertEquals(409, assertThrows(AppException.class,
                () -> service.pass("U1", "W1", "D1", body)).getCode());
        assertEquals(5L, service.pass("U1", "W1", "D1", null).getRevision());
    }

    @Test
    void detailTasksUseTheirOwnVersionAndPublishedTimestamp() {
        Task task = new Task();
        task.setId("K1"); task.setWorkspaceId("W1");
        com.hourglass.dto.TaskVersionBinding row = new com.hourglass.dto.TaskVersionBinding();
        row.setTaskId("K1"); row.setVersionId("V-task"); row.setVersionName("任务实际版本");
        when(bindings.selectVersionRowsByTaskIds("W1", Collections.singletonList("K1"))).thenReturn(Collections.singletonList(row));
        com.hourglass.entity.VersionRelease record = new com.hourglass.entity.VersionRelease();
        record.setId("VR1"); record.setResult("success"); record.setEnvironment("production");
        record.setOperation("deploy"); record.setCoverage("full"); record.setTargetKeys(Collections.singletonList("main"));
        record.setOccurredAt(LocalDate.of(2026, 11, 9).atStartOfDay()); record.setRecordedAt(record.getOccurredAt());
        com.hourglass.entity.VersionReleaseItem item = new com.hourglass.entity.VersionReleaseItem();
        item.setTaskId("K1"); item.setDisposition("published"); record.setItems(Collections.singletonList(item));
        when(releases.selectPublicationRecords("W1", Collections.singletonList("K1"))).thenReturn(Collections.singletonList(record));
        when(tasks.countActiveByDemand("W1", "D1")).thenReturn(1);
        when(demands.selectDemandTasks("W1", "D1", 0, 100)).thenReturn(Collections.singletonList(task));
        Task result = service.tasks("W1", "U1", "D1", 0, 100).getItems().get(0);
        assertEquals(Collections.singletonList("V-task"), result.getVersionIds());
        assertEquals(Collections.singletonList("任务实际版本"), result.getVersionNames());
        assertEquals(LocalDate.of(2026, 11, 9), result.getPublishedAt());
        assertTrue(result.getEverPublished());
        assertFalse(result.getCanPublish()); assertFalse(result.getCanUnpublish());
    }

    @ParameterizedTest
    @ValueSource(strings = {"manual", "version_release", "trash"})
    void formalDemandHistoryRatherThanTaskTimestampProtectsDelete(String source) {
        Task current = new Task();
        current.setId("K1");
        current.setDemandId("D1");
        current.setPublishedAt(LocalDate.of(2026, 11, 9));
        current.setPublishSource(source);
        when(releases.selectDemandRecords("W1", "D1")).thenReturn(Collections.singletonList(new com.hourglass.entity.VersionRelease()));
        if ("trash".equals(source)) current.setDeletedAt(LocalDateTime.now());
        when(tasks.selectTasksByDemandForScope("W1", "D1")).thenReturn(Collections.singletonList(current));

        AppException error = assertThrows(AppException.class, () -> service.delete("U1", "W1", "D1"));

        assertEquals(400, error.getCode());
        assertTrue(error.getMessage().contains("正式发布历史"));
        InOrder order = inOrder(lock, tasks, demands);
        order.verify(demands).selectById("D1");
        order.verify(lock).lockProjects("W1", "R1");
        order.verify(tasks).selectTasksByDemandForScope("W1", "D1");
        order.verify(demands).selectByIdForUpdate("W1", "D1");
        verify(tasks, never()).clearDemandRef(anyString(), anyString());
        verify(demands, never()).deleteById(anyString(), anyString());
        verify(demands, never()).deleteLogsByDemand(anyString(), anyString());
        verifyNoInteractions(attachments, mail, docs, cases, events, permissions);
    }

    @ParameterizedTest
    @ValueSource(strings = {"revision", "project"})
    void deleteRejectsChangedDemandFromCurrentRead(String change) {
        Demand current = new Demand();
        current.setId("D1");
        current.setWorkspaceId("W1");
        current.setReqId("project".equals(change) ? "R2" : "R1");
        current.setRevision("revision".equals(change) ? 5L : 4L);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(current);

        assertEquals(409, assertThrows(AppException.class,
                () -> service.delete("U1", "W1", "D1")).getCode());

        verify(tasks, never()).clearDemandRef(anyString(), anyString());
        verify(demands, never()).deleteById(anyString(), anyString());
        verifyNoInteractions(attachments, mail, docs, cases, events);
    }

    @ParameterizedTest
    @ValueSource(strings = {"empty", "unpublished", "trash"})
    void deleteWithoutPublishedLinksKeepsExistingCleanupBoundary(String state) {
        if (!"empty".equals(state)) {
            Task task = new Task();
            task.setId("K1");
            task.setDemandId("D1");
            if ("trash".equals(state)) task.setDeletedAt(LocalDateTime.now());
            when(tasks.selectTasksByDemandForScope("W1", "D1")).thenReturn(Collections.singletonList(task));
        }

        service.delete("U1", "W1", "D1");

        InOrder order = inOrder(lock, tasks, demands, attachments);
        order.verify(lock).lockProjects("W1", "R1");
        order.verify(tasks).selectTasksByDemandForScope("W1", "D1");
        order.verify(demands).selectByIdForUpdate("W1", "D1");
        order.verify(attachments).deleteByTarget("W1", "D1", AttachmentService.KIND_DEMAND);
        order.verify(tasks).clearDemandRef("W1", "D1");
        order.verify(demands).deleteLogsByDemand("W1", "D1");
        order.verify(demands).deleteById("W1", "D1");
        verify(mail).deleteByReferenceIds(Collections.singletonList("D1"));
        verify(docs).deleteDemandLinksByDemand("W1", "D1");
        verify(cases).clearDemandRefs("W1", "D1");
        verify(deletionTrace).recordDelete(eq("W1"), eq("U1"), eq("demand_delete"), eq("demand"),
                eq("D1"), eq("需求"), contains("删除需求「需求」（项目 R1；解除"));
        verify(deletionTrace).logTaskCascade(eq("W1"), eq("U1"), anyList(),
                eq("关联需求「需求」已删除，自动解除关联"));
        verifyNoInteractions(permissions);
    }

    @Test
    void controllerKeepsOwnerReviewAndDelegatesSchedulePermissionToService() throws Exception {
        Class<?> controller = com.hourglass.controller.DemandController.class;
        for (String action : new String[] {"plan", "replan", "unplan", "cancel", "restore"}) {
            assertFalse(controller.getDeclaredMethod(action, String.class, DemandActionRequest.class,
                    com.hourglass.config.WorkspaceCtx.class)
                    .isAnnotationPresent(com.hourglass.common.RequireRole.class));
        }
        assertTrue(controller.getDeclaredMethod("delete", String.class, com.hourglass.config.WorkspaceCtx.class)
                .isAnnotationPresent(com.hourglass.common.RequireRole.class));
        for (String action : new String[] {"pass", "reject", "unpass", "reopen"}) {
            assertTrue(controller.getDeclaredMethod(action, String.class, DemandActionRequest.class,
                    com.hourglass.config.WorkspaceCtx.class)
                    .isAnnotationPresent(com.hourglass.common.RequireRole.class));
        }
    }

    @Test
    void mapperUpdateHasRevisionPredicateAndIncrementAndReturnsStructuredLog() throws Exception {
        Configuration configuration = new Configuration();
        configuration.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        configuration.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream("mapper/TaskMapper.xml")) {
            new XMLMapperBuilder(stream, configuration, "mapper/TaskMapper.xml", configuration.getSqlFragments()).parse();
        }
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream("mapper/ReleaseMapper.xml")) {
            new XMLMapperBuilder(stream, configuration, "mapper/ReleaseMapper.xml", configuration.getSqlFragments()).parse();
        }
        String resource = "mapper/DemandMapper.xml";
        try (InputStream stream = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(stream);
            new XMLMapperBuilder(stream, configuration, resource, configuration.getSqlFragments()).parse();
        }
        String update = configuration.getMappedStatement("com.hourglass.mapper.DemandMapper.update")
                .getBoundSql(demand).getSql().replaceAll("\\s+", " ");
        assertTrue(update.contains("revision = revision + 1"));
        assertTrue(update.contains("AND revision = ?"));
        assertTrue(update.contains("planned_start = ?"));
        String updateProject = configuration.getMappedStatement("com.hourglass.mapper.DemandMapper.updateProject")
                .getBoundSql(demand).getSql().replaceAll("\\s+", " ");
        assertTrue(updateProject.contains("req_id = ?"));
        assertTrue(updateProject.contains("revision = revision + 1"));
        assertTrue(updateProject.contains("AND revision = ?"));
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("workspaceId", "W1");
        params.put("demandId", "D1");
        params.put("offset", 0);
        params.put("limit", 100);
        String logs = configuration.getMappedStatement("com.hourglass.mapper.DemandMapper.selectLogs")
                .getBoundSql(params).getSql();
        assertTrue(logs.contains("change_data AS changeData"));
        String related = configuration.getMappedStatement("com.hourglass.mapper.DemandMapper.selectDemandTasks")
                .getBoundSql(params).getSql();
        assertFalse(related.contains("pv.name AS versionName"), "任务版本来自独立 M:N 批量投影，不再取需求 scalar 目标");
        assertFalse(related.contains("JOIN version_task"), "M:N 关联不能倍增分页任务");
        params.put("reqId", "R1");
        params.put("id", "V1");
        String target = configuration.getMappedStatement("com.hourglass.mapper.DemandMapper.selectScheduleVersion")
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertTrue(target.contains("req_id = ?"));
        assertTrue(target.contains("FOR UPDATE"));
        String current = configuration.getMappedStatement("com.hourglass.mapper.DemandMapper.selectByIdForUpdate")
                .getBoundSql(params).getSql();
        assertTrue(current.contains("FOR UPDATE"));
    }

    @Test
    void quickPriorityUpdatesWithoutStatusChangeAndLogsSnapshot() throws Exception {
        demand.setStatus("review");
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setPriority("P0");

        Demand result = service.quickPriority("U1", "W1", "D1", body);

        assertEquals("P0", result.getPriority());
        assertEquals("review", result.getStatus());
        assertEquals(5L, result.getRevision());
        JsonNode log = changeLog("priority");
        assertEquals("P2", log.path("before").path("priority").asText());
        assertEquals("P0", log.path("after").path("priority").asText());
        assertEquals("review", log.path("after").path("status").asText());
        assertEquals(5, log.path("after").path("revision").asInt());
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("priority"),
                eq("优先级：P2 → P0"), eq("U1"), anyString());
        verifyNoInteractions(lock, versions);
    }

    @Test
    void quickPriorityRejectsClosedDemandAndMissingRevision() {
        demand.setStatus("closed");
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setPriority("P0");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.quickPriority("U1", "W1", "D1", body)).getCode());
        demand.setStatus("review");
        body.setRevision(null);
        assertEquals(400, assertThrows(AppException.class,
                () -> service.quickPriority("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).update(any());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), any(), anyString(), anyString());
    }

    @Test
    void quickExpectDateCanClearAndLogsChange() throws Exception {
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setExpectDate(null);

        Demand result = service.quickExpectDate("U1", "W1", "D1", body);

        assertNull(result.getExpectDate());
        assertEquals(5L, result.getRevision());
        JsonNode log = changeLog("expect");
        assertEquals("2026-12-20", log.path("before").path("expectDate").asText());
        assertTrue(log.path("after").path("expectDate").isNull());
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("expect"),
                eq("期望交付：2026-12-20 → 已清空"), eq("U1"), anyString());
    }

    @Test
    void quickVersionRequiresPlanningStatusAndUnreleasedTarget() throws Exception {
        demand.setStatus("plan");
        demand.setCreatedBy("U-submit");
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setVersionId("V1");
        body.setNote("交付节奏调整");

        Demand result = service.quickVersion("U1", "W1", "D1", body);

        assertEquals("V1", result.getVersionId());
        assertEquals("1.0", result.getVersionName());
        assertEquals(5L, result.getRevision());
        JsonNode log = changeLog("version");
        assertTrue(log.path("before").path("versionId").isNull());
        assertEquals("1.0", log.path("after").path("versionName").asText());
        assertEquals("交付节奏调整", log.path("reason").asText());
        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「需求」目标版本已调整"), eq("目标版本：1.0；交付节奏调整"), eq("demand"), eq("D1"), eq("R1"));

        demand.setStatus("pass");
        DemandActionRequest wrongStatus = new DemandActionRequest();
        wrongStatus.setRevision(5L);
        wrongStatus.setVersionId("V1");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.quickVersion("U1", "W1", "D1", wrongStatus)).getCode());
    }

    @Test
    void quickVersionChangeRequiresReason() {
        demand.setStatus("plan");
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setVersionId("V1");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.quickVersion("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).update(any());
    }

    @Test
    void quickVersionRejectsReleasedVersionAndMissingManagePermission() {
        demand.setStatus("plan");
        version.setStatus("released");
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setVersionId("V1");
        assertEquals(400, assertThrows(AppException.class,
                () -> service.quickVersion("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).update(any());

        version.setStatus("planning");
        doThrow(new AppException(403, "forbidden")).when(permissions)
                .assertManageProject("U1", "W1", "R1");
        assertEquals(403, assertThrows(AppException.class,
                () -> service.quickVersion("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).update(any());
    }

    @Test
    void moveUpdatesProjectAndClearsForeignModuleWithLog() throws Exception {
        demand.setStatus("review");
        demand.setCategoryId("C1");
        demand.setCreatedBy("U-submit");
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        target.setName("目标项目");
        when(projects.selectById("R2")).thenReturn(target);
        when(demands.updateProject(any(Demand.class))).thenReturn(1);
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        Demand result = service.move("U1", "W1", "D1", body);

        assertEquals("R2", result.getReqId());
        assertNull(result.getCategoryId());
        assertEquals(5L, result.getRevision());
        verify(demands).updateProject(any(Demand.class));
        verify(demands, never()).update(any());
        JsonNode log = changeLog("move");
        assertEquals("R1", log.path("before").path("reqId").asText());
        assertEquals("C1", log.path("before").path("categoryId").asText());
        assertEquals("R2", log.path("after").path("reqId").asText());
        assertTrue(log.path("after").path("categoryId").isNull());
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("move"),
                eq("所属项目：R1 → 目标项目；原模块不属于目标项目，已清空"), eq("U1"), anyString());
        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「需求」所属项目已变更"), eq("从「R1」移至「目标项目」"),
                eq("demand"), eq("D1"), eq("R2"));
    }

    @Test
    void moveZeroAffectedRowsIsConflictWithoutLog() {
        demand.setStatus("review");
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(target);
        when(demands.updateProject(any(Demand.class))).thenReturn(0);
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        assertEquals(409, assertThrows(AppException.class,
                () -> service.move("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), any(), anyString(), anyString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"pass", "plan", "closed"})
    void moveRejectsDemandThatLeftReview(String status) {
        demand.setStatus(status);
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(target);
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        assertEquals(400, assertThrows(AppException.class,
                () -> service.move("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).updateProject(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"tasks", "docs", "cases", "releases"})
    void moveRejectsDemandWithExecutionEvidence(String evidence) {
        demand.setStatus("review");
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(target);
        if ("tasks".equals(evidence)) {
            when(tasks.selectTasksByDemandForScope("W1", "D1")).thenReturn(Collections.singletonList(new Task()));
        }
        if ("docs".equals(evidence)) {
            when(docs.countLinksByDemand("W1", "D1")).thenReturn(1);
        }
        if ("cases".equals(evidence)) {
            when(cases.countByDemandRef("W1", "D1")).thenReturn(1);
        }
        if ("releases".equals(evidence)) {
            when(releases.selectDemandRecords("W1", "D1"))
                    .thenReturn(Collections.singletonList(new com.hourglass.entity.VersionRelease()));
        }
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        assertEquals(400, assertThrows(AppException.class,
                () -> service.move("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).updateProject(any());
    }

    @Test
    void moveRequiresWritePermissionOnBothProjectsBeforeLock() {
        demand.setStatus("review");
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(target);
        doThrow(new AppException(403, "forbidden")).when(access).assertWrite("W1", "U1", "R2");
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        assertEquals(403, assertThrows(AppException.class,
                () -> service.move("U1", "W1", "D1", body)).getCode());
        verifyNoInteractions(lock);
        verify(demands, never()).updateProject(any());
    }

    @Test
    void moveRejectsArchivedTargetProjectBeforeLock() {
        demand.setStatus("review");
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        target.setArchivedAt(LocalDateTime.now());
        when(projects.selectById("R2")).thenReturn(target);
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        assertEquals(400, assertThrows(AppException.class,
                () -> service.move("U1", "W1", "D1", body)).getCode());
        verifyNoInteractions(lock);
        verify(demands, never()).updateProject(any());
    }

    @Test
    void moveRejectsDemandThatAlreadyHasTargetVersion() {
        demand.setStatus("review");
        demand.setVersionId("V-old");
        Requirement target = new Requirement();
        target.setId("R2");
        target.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(target);
        DemandActionRequest body = new DemandActionRequest();
        body.setRevision(4L);
        body.setReqId("R2");

        assertEquals(400, assertThrows(AppException.class,
                () -> service.move("U1", "W1", "D1", body)).getCode());
        verify(demands, never()).updateProject(any());
    }

    private void planned() {
        demand.setStatus("plan");
        demand.setVersionId("V-old");
        demand.setVersionName("Old");
        demand.setPlannedStart(LocalDate.of(2026, 12, 1));
        demand.setPlannedEnd(LocalDate.of(2026, 12, 10));
    }

    private Demand perform(String action, DemandActionRequest body) {
        if ("replan".equals(action)) return service.replan("U1", "W1", "D1", body);
        if ("unplan".equals(action)) return service.unplan("U1", "W1", "D1", body);
        if ("cancel".equals(action)) return service.cancel("U1", "W1", "D1", body);
        return service.restore("U1", "W1", "D1", body);
    }

    private JsonNode changeLog(String action) throws Exception {
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq(action), any(), eq("U1"), json.capture());
        return new ObjectMapper().readTree(json.getValue());
    }
}
