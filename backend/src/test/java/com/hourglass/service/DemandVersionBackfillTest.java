package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.DemandVersionTaskRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Task;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DemandVersionBackfillTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final DeliveryScopeLock lock = mock(DeliveryScopeLock.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final com.hourglass.mapper.VersionTaskMapper bindings = mock(com.hourglass.mapper.VersionTaskMapper.class);
    private final TaskPublicationService publications = mock(TaskPublicationService.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final DemandService service = new DemandService(demands, mock(RequirementMapper.class), versions, tasks,
            mock(NotificationEventService.class), mock(com.hourglass.mapper.RequirementDocMapper.class),
            access, mock(AttachmentService.class), mock(com.hourglass.mapper.MailDeliveryMapper.class),
            mock(com.hourglass.mapper.TestCaseMapper.class), mock(com.hourglass.mapper.CategoryMapper.class),
            lock, permissions, mock(DeletionTraceService.class), mock(NumberSeqService.class),
            mock(DemandWatchService.class));
    private Demand demand;
    private ProjectVersion version;

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(service, "versionTaskMapper", bindings);
        ReflectionTestUtils.setField(service, "publications", publications);
        ReflectionTestUtils.setField(service, "taskAudit", audit);
        demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId("W1");
        demand.setReqId("R1");
        demand.setTitle("需求");
        demand.setStatus("plan");
        demand.setVersionId("V1");
        demand.setRevision(4L);
        when(demands.selectById("D1")).thenReturn(demand);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(demand);
        version = new ProjectVersion();
        version.setId("V1");
        version.setWorkspaceId("W1");
        version.setReqId("R1");
        version.setName("1.0");
        version.setStatus("planning");
        when(versions.selectByIdForUpdate("W1", "V1")).thenReturn(version);
        when(versions.selectById("V1")).thenReturn(version);
        when(tasks.hasVersionFormalRelease("W1", "V1")).thenReturn(false);
        when(tasks.selectVersionFormalSuccessIdsForScope("W1", "V1")).thenReturn(Collections.<String>emptyList());
        when(tasks.touchDeliveryRevision(anyString(), anyString())).thenReturn(1);
        when(bindings.insertBatch(anyString(), anyString(), anyList())).thenReturn(1);
        when(versions.touchRevision("W1", "V1")).thenReturn(1);
    }

    private DemandVersionTaskRequest body(String versionId, String... taskIds) {
        DemandVersionTaskRequest req = new DemandVersionTaskRequest();
        req.setVersionId(versionId);
        req.setTaskIds(Arrays.asList(taskIds));
        return req;
    }

    private Task task(String id) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId("W1");
        t.setReqId("R1");
        t.setDemandId("D1");
        t.setTitle("工作项 " + id);
        return t;
    }

    @Test
    void candidatesClampLimitAndPassVersion() {
        when(demands.countVersionCandidates("W1", "D1", "V1")).thenReturn(3);
        when(demands.selectVersionCandidates("W1", "D1", "V1", 0, 100))
                .thenReturn(Collections.singletonList(task("T1")));

        com.hourglass.dto.PageResult<Task> page = service.versionTaskCandidates("W1", "U1", "D1", "V1", 0, 500);

        assertEquals(3, page.getTotal());
        assertEquals(1, page.getItems().size());
        verify(demands).selectVersionCandidates("W1", "D1", "V1", 0, 100);
        verify(bindings).enrichTasks(eq("W1"), anyList());
        /* 读路径不得走加锁查询 */
        verify(demands, never()).selectScheduleVersion(anyString(), anyString(), anyString());
        verify(tasks, never()).selectVersionFormalSuccessIdsForScope(anyString(), anyString());
    }

    @Test
    void candidatesRejectVersionOutsideProject() {
        demand.setVersionId("V9");
        ProjectVersion foreign = new ProjectVersion();
        foreign.setId("V9");
        foreign.setWorkspaceId("W1");
        foreign.setReqId("R2");
        when(versions.selectById("V9")).thenReturn(foreign);

        AppException ex = assertThrows(AppException.class,
                () -> service.versionTaskCandidates("W1", "U1", "D1", "V9", 0, 100));

        assertEquals(400, ex.getCode());
        verifyNoInteractions(bindings, publications);
    }

    @Test
    void candidatesAllowPassPreviewBeforeScheduling() {
        demand.setStatus("pass");
        demand.setVersionId(null);
        when(demands.countVersionCandidates("W1", "D1", "V1")).thenReturn(2);
        when(demands.selectVersionCandidates("W1", "D1", "V1", 0, 100))
                .thenReturn(Collections.singletonList(task("T1")));

        com.hourglass.dto.PageResult<Task> page = service.versionTaskCandidates("W1", "U1", "D1", "V1", 0, 100);

        assertEquals(2, page.getTotal());
        assertEquals(1, page.getItems().size());
    }

    @Test
    void candidatesRejectDemandOutsideScheduling() {
        demand.setStatus("review");

        AppException ex = assertThrows(AppException.class,
                () -> service.versionTaskCandidates("W1", "U1", "D1", "V1", 0, 100));

        assertEquals(400, ex.getCode());
        verify(demands, never()).countVersionCandidates(anyString(), anyString(), anyString());
    }

    @Test
    void candidatesRejectStaleTargetVersion() {
        AppException ex = assertThrows(AppException.class,
                () -> service.versionTaskCandidates("W1", "U1", "D1", "V2", 0, 100));

        assertEquals(409, ex.getCode());
        verify(versions, never()).selectById(anyString());
        verify(demands, never()).countVersionCandidates(anyString(), anyString(), anyString());
    }

    @Test
    void candidatesEmptyWhenReleaseFrozen() {
        when(tasks.hasVersionFormalRelease("W1", "V1")).thenReturn(true);

        com.hourglass.dto.PageResult<Task> page = service.versionTaskCandidates("W1", "U1", "D1", "V1", 0, 100);

        assertEquals(0, page.getTotal());
        assertTrue(page.getItems().isEmpty());
        verify(demands, never()).countVersionCandidates(anyString(), anyString(), anyString());
        verifyNoInteractions(bindings, publications);
    }

    @Test
    void bindSkipsExistingAndAuditsNewMembership() {
        when(lock.lockTask("W1", "T1")).thenReturn(task("T1"));
        when(lock.lockTask("W1", "T2")).thenReturn(task("T2"));
        when(tasks.selectTaskVersionsForScope("W1", "T1")).thenReturn(Collections.singletonList("V1"));
        when(tasks.selectTaskVersionsForScope("W1", "T2")).thenReturn(Collections.<String>emptyList());

        Map<String, Object> result = service.bindVersionTasks("U1", "W1", "D1", body("V1", "T1", "T2"));

        assertEquals(1, result.get("added"));
        assertEquals(1, result.get("skipped"));
        verify(bindings).insertBatch("W1", "V1", Collections.singletonList("T2"));
        verify(bindings, never()).insertBatch("W1", "V1", Collections.singletonList("T1"));
        verify(tasks).touchDeliveryRevision("W1", "T2");
        verify(versions).touchRevision("W1", "V1");
        verify(audit).logChange(eq("U1"), eq("W1"), eq("T2"), eq("version_change"),
                eq("需求排期带入版本：1.0"), any(), org.mockito.ArgumentMatchers.<Map<String, Object>>argThat(after ->
                        "demand-batch".equals(after.get("inheritanceSource"))
                                && "D1".equals(after.get("demandId"))
                                && ((List<?>) after.get("versionIds")).contains("V1")),
                eq("需求「需求」排期带入版本"));
        verify(audit, never()).logChange(any(), any(), eq("T1"), any(), any(), any(), any(), any());
    }

    @Test
    void bindRejectsStaleTargetVersion() {
        AppException ex = assertThrows(AppException.class,
                () -> service.bindVersionTasks("U1", "W1", "D1", body("V2", "T1")));

        assertEquals(409, ex.getCode());
        verify(lock, never()).lockTask(anyString(), anyString());
    }

    @Test
    void bindRejectsReleaseFrozenVersion() {
        when(tasks.selectVersionFormalSuccessIdsForScope("W1", "V1"))
                .thenReturn(Collections.singletonList("REL1"));

        AppException ex = assertThrows(AppException.class,
                () -> service.bindVersionTasks("U1", "W1", "D1", body("V1", "T1")));

        assertEquals(400, ex.getCode());
        assertTrue(ex.getMessage().contains("冻结"));
        verifyNoInteractions(bindings);
    }

    @Test
    void bindRejectsClosedVersion() {
        version.setStatus("closed");

        AppException ex = assertThrows(AppException.class,
                () -> service.bindVersionTasks("U1", "W1", "D1", body("V1", "T1")));

        assertEquals(400, ex.getCode());
        verifyNoInteractions(bindings);
    }

    @Test
    void bindRejectsUnplannedDemand() {
        demand.setStatus("pass");

        AppException ex = assertThrows(AppException.class,
                () -> service.bindVersionTasks("U1", "W1", "D1", body("V1", "T1")));

        assertEquals(400, ex.getCode());
        verifyNoInteractions(bindings);
    }

    @Test
    void bindRejectsTaskFromAnotherDemand() {
        Task foreign = task("T1");
        foreign.setDemandId("D2");
        when(lock.lockTask("W1", "T1")).thenReturn(foreign);
        when(tasks.selectTaskVersionsForScope("W1", "T1")).thenReturn(Collections.<String>emptyList());

        AppException ex = assertThrows(AppException.class,
                () -> service.bindVersionTasks("U1", "W1", "D1", body("V1", "T1")));

        assertEquals(400, ex.getCode());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @Test
    void bindRollsBackWhenMembershipChangedConcurrently() {
        when(lock.lockTask("W1", "T1")).thenReturn(task("T1"));
        when(tasks.selectTaskVersionsForScope("W1", "T1")).thenReturn(Collections.<String>emptyList());
        when(bindings.insertBatch("W1", "V1", Collections.singletonList("T1"))).thenReturn(0);

        AppException ex = assertThrows(AppException.class,
                () -> service.bindVersionTasks("U1", "W1", "D1", body("V1", "T1")));

        assertEquals(409, ex.getCode());
        verify(versions, never()).touchRevision(anyString(), anyString());
    }
}
