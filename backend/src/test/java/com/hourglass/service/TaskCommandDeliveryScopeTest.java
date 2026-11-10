package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.*;
import com.hourglass.mapper.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import com.hourglass.dto.TaskVersionBinding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TaskCommandDeliveryScopeTest {
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper projects = mock(RequirementMapper.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final VersionTaskMapper bindings = mock(VersionTaskMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final DeliveryScopeLock locks = mock(DeliveryScopeLock.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final TaskWorkflowService workflow = mock(TaskWorkflowService.class);
    private final TaskCommandService service = new TaskCommandService(tasks, projects, mock(SubtaskMapper.class),
            mock(CategoryMapper.class), users, mock(RequirementDocMapper.class), mock(DevBranchMapper.class),
            members, versions, bindings, demands, mock(WorkspaceMetaCache.class), support,
            mock(TaskCompletionService.class), workflow, audit, mock(NotificationEventService.class), access,
            mock(TimeLogService.class), locks, permissions);
    private final ReleaseMapper records = mock(ReleaseMapper.class);
    private final TaskPublicationService publications = spy(new TaskPublicationService(tasks, records,
            mock(TaskLogMapper.class), locks, permissions, new com.fasterxml.jackson.databind.ObjectMapper()));
    private final Map<String, List<String>> persistedBindings = new HashMap<String, List<String>>();
    private Task old;
    private Demand demand;

    @BeforeEach
    void prepare() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", publications);
        when(tasks.update(any(Task.class))).thenReturn(1);
        doCallRealMethod().when(bindings).enrichTasks(anyString(), anyList());
        when(bindings.selectVersionIdsByTask(eq("W1"), anyString()))
                .thenAnswer(call -> persistedBindings.getOrDefault(call.getArgument(1), Collections.emptyList()));
        when(tasks.selectTaskVersionsForScope(eq("W1"), anyString()))
                .thenAnswer(call -> persistedBindings.getOrDefault(call.getArgument(1), Collections.emptyList()));
        when(bindings.selectVersionRowsByTaskIds(eq("W1"), anyList())).thenAnswer(call -> {
            List<TaskVersionBinding> rows = new ArrayList<TaskVersionBinding>();
            for (String id : (List<String>) call.getArgument(1)) {
                for (String versionId : persistedBindings.getOrDefault(id, Collections.emptyList())) {
                    TaskVersionBinding row = new TaskVersionBinding();
                    row.setTaskId(id); row.setVersionId(versionId); row.setVersionName("版本 " + versionId);
                    rows.add(row);
                }
            }
            return rows;
        });
        when(bindings.insertBatch(eq("W1"), anyString(), anyList())).thenAnswer(call -> {
            for (String id : (List<String>) call.getArgument(2)) {
                persistedBindings.computeIfAbsent(id, key -> new ArrayList<String>()).add(call.getArgument(1));
            }
            return ((List<?>) call.getArgument(2)).size();
        });
        when(bindings.deleteBinding(eq("W1"), anyString(), anyString())).thenAnswer(call ->
                persistedBindings.getOrDefault(call.getArgument(1), Collections.emptyList()).remove(call.getArgument(2)) ? 1 : 0);
        Requirement project = new Requirement();
        project.setId("R1");
        project.setWorkspaceId("W1");
        when(projects.selectById("R1")).thenReturn(project);
        old = new Task();
        old.setId("K1");
        old.setWorkspaceId("W1");
        old.setReqId("R1");
        old.setOwnerUserId("U1");
        old.setBoardColumn("backlog");
        when(tasks.selectById("K1")).thenReturn(old);
        when(support.require("W1", "K1")).thenReturn(old);
        when(locks.lockTask("W1", "K1")).thenReturn(old);
        when(audit.diffParts(eq("W1"), any(), any(), any(), any())).thenReturn(new ArrayList<String>());
        when(support.tagNames("W1", "K1")).thenReturn(Collections.emptyList());
        demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId("W1");
        demand.setReqId("R1");
        demand.setTitle("需求目标");
        demand.setStatus("plan");
        demand.setVersionId("V1");
        when(demands.selectById("D1")).thenReturn(demand);
        when(tasks.selectDemandForScope("W1", "D1")).thenReturn(demand);
        version("V1", "planned", "R1");
        version("V2", "active", "R1");
        snapshot("member", null, null);
    }

    private void snapshot(String role, String access, String projectOwner) {
        Map<String, Object> snapshot = new java.util.HashMap<String, Object>();
        snapshot.put("role", role);
        snapshot.put("access", access);
        snapshot.put("projectOwnerUserId", projectOwner);
        when(members.selectDeliveryAccessForUpdate("W1", "U1", "R1")).thenReturn(snapshot);
    }

    private ProjectVersion version(String id, String status, String project) {
        ProjectVersion v = new ProjectVersion();
        v.setId(id);
        v.setWorkspaceId("W1");
        v.setReqId(project);
        v.setStatus(status);
        v.setName("版本 " + id);
        when(versions.selectById(id)).thenReturn(v);
        when(tasks.selectVersionForScope("W1", id)).thenReturn(v);
        return v;
    }

    private TaskSaveRequest request() {
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle("任务");
        req.setReqId("R1");
        req.setDemandId("D1");
        return req;
    }

    private void update(TaskSaveRequest req) { service.update("U1", "W1", "K1", req); }

    @Test
    void createNullInheritsScheduledDemandWithStructuredSourceAndNoReason() {
        service.create("U1", "W1", request());
        verify(bindings).insertBatch(eq("W1"), eq("V1"), anyList());
        ArgumentCaptor<Object> after = ArgumentCaptor.forClass(Object.class);
        verify(audit).logChange(eq("U1"), eq("W1"), anyString(), eq("version_change"), anyString(),
                any(), after.capture(), isNull());
        Map<?, ?> data = (Map<?, ?>) after.getValue();
        assertEquals("demand", data.get("inheritanceSource"));
        assertEquals("D1", data.get("demandId"));
        assertEquals(Collections.singletonList("V1"), data.get("versionIds"));
        assertEquals(Collections.singletonList("版本 V1"), data.get("versionNames"));
        verifyNoInteractions(permissions);
        InOrder order = inOrder(locks, demands, tasks);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(tasks, calls(1)).selectDemandForScope("W1", "D1");
        order.verify(tasks).insert(any(Task.class));
    }

    @Test
    void createEmptyExplicitlySkipsInheritanceWithoutAdjustmentReason() {
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.emptyList());
        req.setVersionChangeReason("显式不继承需求排期");
        snapshot("owner", null, "U1");
        service.create("U1", "W1", req);
        verifyNoInteractions(bindings, permissions);
    }

    @Test
    void unscheduledDemandDoesNotInherit() {
        demand.setStatus("pass");
        service.create("U1", "W1", request());
        verifyNoInteractions(bindings);
    }

    @Test
    void createReadsDemandTargetAfterProjectLock() {
        doAnswer(invocation -> { demand.setVersionId("V2"); return null; })
                .when(locks).lockProjects("W1", "R1");
        service.create("U1", "W1", request());
        verify(bindings).insertBatch(eq("W1"), eq("V2"), anyList());
    }

    @Test
    void canceledDemandRejectsNewTask() {
        demand.setStatus("canceled");
        assertTrue(assertThrows(AppException.class, () -> service.create("U1", "W1", request()))
                .getMessage().contains("已取消需求"));
        verify(tasks, never()).insert(any());
    }

    @Test
    void oldCanceledAssociationIsPreservedDuringOrdinaryEdit() {
        old.setDemandId("D1");
        demand.setStatus("canceled");
        TaskSaveRequest req = request();
        req.setDemandId(null);
        update(req);
        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).update(saved.capture());
        assertEquals("D1", saved.getValue().getDemandId());
    }

    @Test
    void editCannotNewlyAssociateCanceledDemand() {
        demand.setStatus("canceled");
        assertThrows(AppException.class, () -> update(request()));
        verify(tasks, never()).update(any());
    }

    @Test
    void releasedTargetCannotReceiveNewBindingsIncludingInheritance() {
        version("V1", "active", "R1");
        when(tasks.selectVersionFormalSuccessIdsForScope("W1", "V1")).thenReturn(Collections.singletonList("VR1"));
        assertThrows(AppException.class, () -> service.create("U1", "W1", request()));
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
        verify(versions, never()).touchRevision(anyString(), anyString());
    }

    @Test
    void createOverrideRequiresManagementPermissionAndReason() {
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        AppException denied = assertThrows(AppException.class, () -> service.create("U1", "W1", req));
        assertEquals(403, denied.getCode());
        snapshot("member", null, "U1");
        assertTrue(assertThrows(AppException.class, () -> service.create("U1", "W1", req))
                .getMessage().contains("versionChangeReason"));
        req.setVersionChangeReason("需求目标不变，任务拆分顺延");
        service.create("U1", "W1", req);
        verify(bindings).insertBatch(eq("W1"), eq("V2"), anyList());
    }

    @Test
    void editNullRetainsReleasedBindingWithoutReason() {
        version("V1", "released", "R1");
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        update(request());
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verifyNoInteractions(permissions);
        verify(permissions, never()).canManageProject(anyString(), anyString(), any());
    }

    @ParameterizedTest
    @CsvSource({"false,true,false", "true,true,false", "false,true,true", "true,true,true",
            "false,false,false", "true,false,false", "false,false,true", "true,false,true"})
    void editOmittedOrNullVersionReturnsBindingAndCurrentPublicationFlags(
            boolean explicitNull, boolean permitted, boolean published) {
        old.setBoardColumn("done");
        old.setCompletedAt(LocalDate.of(2026, 11, 8));
        old.setDemandId("D1");
        if (published) productionHistory("K1");
        version("V1", "released", "R1");
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        when(bindings.selectVersionIdsByTask("W1", "K1")).thenReturn(Collections.singletonList("V1"));
        Task saved = savedUpdateResponse();
        TaskSaveRequest req = assignedRequest("U1");
        req.setBoardColumn("done");
        if (explicitNull) req.setVersionIds(null);
        req.setTags(Collections.singletonList("已保存标签"));
        when(support.tagNames("W1", "K1")).thenReturn(Collections.emptyList(), req.getTags());
        when(permissions.canPublishTask("U1", "W1", saved)).thenReturn(permitted);

        Task result = service.update("U1", "W1", "K1", req);

        assertSame(saved, result);
        assertNotSame(old, result);
        assertEquals(Collections.singletonList("V1"), result.getVersionIds());
        assertEquals(Collections.singletonList("版本 V1"), result.getVersionNames());
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        assertEquals(published ? LocalDate.of(2026, 11, 9) : null, result.getPublishedAt());
        assertEquals(req.getTags(), result.getTags());
        verify(support).saveTags("W1", "K1", req.getTags());
        verify(bindings).selectVersionRowsByTaskIds("W1", Collections.singletonList("K1"));
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
        verifyNoInteractions(permissions);
        verify(publications).enrichTasks("W1", Collections.singletonList(saved));
    }

    @ParameterizedTest
    @CsvSource({"backlog,false", "backlog,true", "done,false"})
    void editAlwaysClearsPublicationActionsRegardlessOfExecutionState(String column, boolean completed) {
        old.setBoardColumn(column);
        if (completed) old.setCompletedAt(LocalDate.of(2026, 11, 8));
        Task saved = savedUpdateResponse();
        saved.setCanPublish(true);
        saved.setCanUnpublish(true);
        when(permissions.canPublishTask("U1", "W1", saved)).thenReturn(true);
        TaskSaveRequest req = assignedRequest("U1");
        req.setBoardColumn(column);

        Task result = service.update("U1", "W1", "K1", req);

        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
    }

    @ParameterizedTest
    @CsvSource({"false,false", "true,false", "false,true", "true,true"})
    void ownerReassignmentKeepsFormalProjectionButNeverEnablesPublicationActions(boolean published, boolean assignedToActor) {
        old.setBoardColumn("done");
        old.setCompletedAt(LocalDate.of(2026, 11, 8));
        if (published) productionHistory("K1");
        old.setDemandId("D1");
        old.setOwnerUserId(assignedToActor ? "U2" : "U1");
        old.setCanPublish(!assignedToActor && !published);
        old.setCanUnpublish(!assignedToActor && published);
        Task saved = savedUpdateResponse();
        saved.setCanPublish(old.getCanPublish());
        saved.setCanUnpublish(old.getCanUnpublish());
        when(permissions.canPublishTask(eq("U1"), eq("W1"), any(Task.class)))
                .thenAnswer(invocation -> "U1".equals(((Task) invocation.getArgument(2)).getOwnerUserId()));
        TaskSaveRequest req = assignedRequest(assignedToActor ? "U1" : "U2");
        req.setBoardColumn("done");

        Task result = service.update("U1", "W1", "K1", req);

        assertEquals(req.getOwnerUserId(), result.getOwnerUserId());
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        verifyNoInteractions(permissions);
        verify(publications).enrichTasks("W1", Collections.singletonList(saved));
    }

    @Test
    void projectChangeWithoutFormalHistoryStillReturnsDisabledPublicationActions() {
        old.setBoardColumn("done");
        old.setCompletedAt(LocalDate.of(2026, 11, 8));
        old.setCanPublish(true);
        Requirement nextProject = new Requirement();
        nextProject.setId("R2");
        nextProject.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(nextProject);
        Task saved = savedUpdateResponse();
        saved.setCanPublish(true);
        when(permissions.canPublishTask(eq("U1"), eq("W1"), any(Task.class)))
                .thenAnswer(invocation -> "R1".equals(((Task) invocation.getArgument(2)).getReqId()));
        TaskSaveRequest req = assignedRequest("U1");
        req.setBoardColumn("done");
        req.setReqId("R2");
        req.setDemandId("");

        Task result = service.update("U1", "W1", "K1", req);

        assertEquals("R2", result.getReqId());
        assertEquals(Collections.emptyList(), result.getVersionIds());
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        verifyNoInteractions(permissions);
        verify(publications).enrichTasks("W1", Collections.singletonList(saved));
    }

    @ParameterizedTest
    @CsvSource({"done,true", "backlog,false"})
    void createResponseIncludesInheritedArraysTagsAndClearsStalePublicationActions(String column, boolean canPublish) {
        TaskSaveRequest req = assignedRequest("U1");
        req.setId("K2");
        req.setBoardColumn(column);
        req.setTags(Collections.singletonList("新建标签"));
        Task saved = new Task();
        saved.setCanPublish(canPublish);
        saved.setCanUnpublish(true);
        when(tasks.selectById("K2")).thenReturn(null, saved);
        doAnswer(invocation -> {
            copySavedFields(invocation.getArgument(0), saved);
            return 1;
        }).when(tasks).insert(any(Task.class));
        when(bindings.selectVersionIdsByTask("W1", "K2")).thenReturn(Collections.singletonList("V1"));
        when(support.tagNames("W1", "K2")).thenReturn(req.getTags());
        when(permissions.canPublishTask("U1", "W1", saved)).thenReturn(true);

        Task result = service.create("U1", "W1", req);

        assertSame(saved, result);
        assertEquals(Collections.singletonList("V1"), result.getVersionIds());
        assertEquals(Collections.singletonList("版本 V1"), result.getVersionNames());
        assertEquals(req.getTags(), result.getTags());
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        InOrder order = inOrder(bindings, publications);
        order.verify(bindings).insertBatch("W1", "V1", Collections.singletonList("K2"));
        order.verify(bindings).enrichTasks("W1", Collections.singletonList(saved));
        order.verify(publications).enrichTasks("W1", Collections.singletonList(saved));
        verifyNoInteractions(permissions);
    }

    private TaskSaveRequest assignedRequest(String ownerUserId) {
        AppUser owner = new AppUser();
        owner.setDisplayName(ownerUserId);
        when(users.selectById(ownerUserId)).thenReturn(owner);
        when(members.selectMember("W1", ownerUserId)).thenReturn(new WorkspaceMember());
        TaskSaveRequest req = request();
        req.setOwnerUserId(ownerUserId);
        return req;
    }

    private Task savedUpdateResponse() {
        Task saved = new Task();
        when(tasks.selectById("K1")).thenReturn(saved);
        doAnswer(invocation -> {
            copySavedFields(invocation.getArgument(0), saved);
            saved.setPublishedAt(LocalDate.of(2026, 1, 1)); // 响应投影必须覆盖旧人工时间戳
            return 1;
        }).when(tasks).update(any(Task.class));
        return saved;
    }

    /** 模拟任务行重新查询；版本数组、正式徽标与标签由响应层填充。 */
    private void copySavedFields(Task source, Task saved) {
        saved.setId(source.getId());
        saved.setWorkspaceId(source.getWorkspaceId());
        saved.setReqId(source.getReqId());
        saved.setOwnerUserId(source.getOwnerUserId());
        saved.setTitle(source.getTitle());
        saved.setBoardColumn(source.getBoardColumn());
        saved.setCompletedAt(source.getCompletedAt());
    }

    @Test
    void editChangedDemandDoesNotSilentlyFollowNewTargetAndIsAudited() {
        demand.setVersionId("V2");
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        update(request());
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verify(audit).logChange(eq("U1"), eq("W1"), eq("K1"), eq("demand_change"), anyString(),
                any(), any(), isNull());
    }

    @Test
    void editEmptyUnbindRequiresReasonEvenForOwner() {
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.emptyList());
        assertTrue(assertThrows(AppException.class, () -> update(req)).getMessage().contains("versionChangeReason"));
        req.setVersionChangeReason("回到待规划");
        Task saved = savedUpdateResponse();
        saved.setVersionIds(Collections.singletonList("V1"));
        Task result = service.update("U1", "W1", "K1", req);
        assertEquals(Collections.emptyList(), result.getVersionIds(), "[] 清理后返回空数组，不回传旧版本");
        assertEquals(Collections.emptyList(), result.getVersionNames());
        verify(bindings).selectVersionRowsByTaskIds("W1", Collections.singletonList("K1"));
        verify(bindings).deleteBinding("W1", "K1", "V1");
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
        verify(versions).touchRevision("W1", "V1");
    }

    @Test
    void unreleasedTaskCanRollForwardFromReleasedVersionWithReason() {
        version("V1", "released", "R1");
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        req.setVersionChangeReason("首版未交付，顺延");
        update(req);
        verify(bindings).insertBatch("W1", "V2", Collections.singletonList("K1"));
        /* 任务侧换版本：迁出与迁入两个版本的 revision 都推进，版本侧打开中的成员表单会得到 409 */
        verify(versions).touchRevision("W1", "V1");
        verify(versions).touchRevision("W1", "V2");
        verify(audit).logChange(eq("U1"), eq("W1"), eq("K1"), eq("version_change"), anyString(),
                any(), any(), eq("首版未交付，顺延"));
    }

    @Test
    void nonOwnerCannotStealOwnershipToAuthorizeVersionChange() {
        old.setOwnerUserId("U2");
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        req.setVersionChangeReason("变更");
        req.setOwnerUserId("U1");
        AppUser user = new AppUser();
        user.setDisplayName("本人");
        when(users.selectById("U1")).thenReturn(user);
        when(members.selectMember("W1", "U1")).thenReturn(new WorkspaceMember());
        assertEquals(403, assertThrows(AppException.class, () -> update(req)).getCode());
    }

    @ParameterizedTest
    @CsvSource({"create,R1,403", "create,,403", "create,R1,404", "create,,404",
            "update,R1,403", "update,,403", "update,R1,404", "update,,404"})
    void currentWriteDenialStopsOrdinarySaveAfterScopeLock(String operation, String projectId, int code) {
        TaskSaveRequest req = request();
        req.setReqId(projectId);
        req.setDemandId("");
        old.setReqId(projectId);
        old.setOwnerUserId("U2");
        doThrow(new AppException(code, "权限已变化"))
                .when(access).assertWriteForUpdate("W1", "U1", projectId);

        AppException failure = assertThrows(AppException.class, () -> {
            if ("create".equals(operation)) service.create("U1", "W1", req);
            else update(req);
        });

        assertEquals(code, failure.getCode());
        InOrder order = inOrder(locks, access);
        if (projectId == null) order.verify(locks).lockProjects("W1");
        else order.verify(locks).lockProjects("W1", projectId);
        if (!"create".equals(operation)) order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", projectId);
        verify(tasks, never()).insert(any());
        verify(tasks, never()).update(any());
        verify(bindings, never()).deleteBinding(anyString(), anyString(), anyString());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
        verifyNoInteractions(audit);
    }

    @Test
    void nonOwnerProjectWriterCanStillSaveWithoutVersionOrStatusChange() {
        old.setOwnerUserId("U2");
        TaskSaveRequest req = request();
        req.setDemandId("");

        update(req);

        verify(access, times(2)).assertWriteForUpdate("W1", "U1", "R1");
        verify(tasks).update(any());
        verify(members, never()).selectDeliveryAccessForUpdate(anyString(), anyString(), any());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @Test
    void destinationProjectWriteIsRevalidatedBeforeAssociationsChange() {
        Requirement next = new Requirement();
        next.setId("R2");
        next.setWorkspaceId("W1");
        when(projects.selectById("R2")).thenReturn(next);
        TaskSaveRequest req = request();
        req.setReqId("R2");
        req.setDemandId("");
        doThrow(new AppException(403, "目标项目只读"))
                .when(access).assertWriteForUpdate("W1", "U1", "R2");

        assertEquals(403, assertThrows(AppException.class, () -> update(req)).getCode());

        InOrder order = inOrder(locks, access);
        order.verify(locks).lockProjects("W1", "R1", "R2");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R1");
        order.verify(access).assertWriteForUpdate("W1", "U1", "R2");
        verify(tasks, never()).update(any());
        verify(bindings, never()).deleteBinding(anyString(), anyString(), anyString());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
        verifyNoInteractions(audit);
    }

    @Test
    void projectReadOnlyCannotAdjustEvenForOwner() {
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        req.setVersionChangeReason("变更");
        doThrow(new AppException(403, "只读")).when(access).assertWriteForUpdate("W1", "U1", "R1");
        assertEquals(403, assertThrows(AppException.class, () -> update(req)).getCode());
    }

    @ParameterizedTest
    @CsvSource({"viewer,,403", "viewer,none,403", "member,read,403", "member,none,404", ",,404"})
    void currentSnapshotDeniesVersionAdjustmentDespiteOrdinaryManagementAndTaskOwnership(
            String role, String grant, int code) {
        when(permissions.canManageProject("U1", "W1", "R1")).thenReturn(true);
        snapshot(role, grant, "U1");
        if (role == null) when(members.selectDeliveryAccessForUpdate("W1", "U1", "R1")).thenReturn(null);
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        req.setVersionChangeReason("调整");
        assertEquals(code, assertThrows(AppException.class, () -> update(req)).getCode());
        InOrder order = inOrder(locks, members);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(members).selectDeliveryAccessForUpdate("W1", "U1", "R1");
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
        verify(tasks, never()).update(any());
        verifyNoInteractions(permissions);
    }

    @ParameterizedTest
    @CsvSource({"owner,none,", "admin,read,", "member,,U1"})
    void currentProjectManagementSnapshotAllowsAdjustmentOfOtherAccountsTask(String role, String grant, String owner) {
        old.setOwnerUserId("U2");
        snapshot(role, grant, owner);
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        req.setVersionChangeReason("调整");
        update(req);
        InOrder order = inOrder(locks, members, bindings);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
        order.verify(members).selectDeliveryAccessForUpdate("W1", "U1", "R1");
        order.verify(bindings).insertBatch("W1", "V2", Collections.singletonList("K1"));
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
        verify(bindings, never()).deleteBinding(anyString(), anyString(), anyString());
        verifyNoInteractions(permissions);
        verify(permissions, never()).canManageProject(anyString(), anyString(), any());
    }

    @Test
    void crossProjectVersionIsRejected() {
        version("V2", "planned", "R2");
        TaskSaveRequest req = request();
        req.setVersionIds(Collections.singletonList("V2"));
        req.setVersionChangeReason("变更");
        assertThrows(AppException.class, () -> update(req));
        verify(bindings, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @Test
    void formalSuccessFreezesOnlyBindingWhileDemandAndExecutionCanChange() {
        old.setBoardColumn("done");
        old.setDemandId("D1");
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        when(tasks.selectVersionFormalSuccessIdsForScope("W1", "V1")).thenReturn(Collections.singletonList("VR1"));
        TaskSaveRequest req = request();
        req.setBoardColumn("done");
        req.setVersionIds(Collections.emptyList());
        req.setVersionChangeReason("变更");
        assertTrue(assertThrows(AppException.class, () -> update(req)).getMessage().contains("已冻结"));
        req.setVersionIds(null);
        req.setDemandId("");
        req.setBoardColumn("doing");
        Task saved = savedUpdateResponse();
        productionHistory("K1");
        Task result = service.update("U1", "W1", "K1", req);
        assertSame(saved, result);
        assertEquals(Collections.singletonList("V1"), result.getVersionIds());
        assertEquals("effective", result.getPublicationState());
        assertEquals(LocalDate.of(2026, 11, 9), result.getPublishedAt());
        verify(bindings, never()).deleteBinding(anyString(), anyString(), anyString());
        verify(workflow).beforeEditColumnChange(eq("U1"), eq("W1"), eq("K1"), eq("done"), eq("doing"), any(), eq(false), eq(false));
    }

    @Test
    void formalHistoryRatherThanManualPublishedAtProtectsProjectIdentity() {
        old.setBoardColumn("done");
        when(tasks.selectTaskRecordIdsForScope("W1", "K1")).thenReturn(Collections.singletonList("VR1"));
        TaskSaveRequest req = request();
        req.setReqId(""); req.setDemandId(""); req.setBoardColumn("done");
        assertTrue(assertThrows(AppException.class, () -> update(req)).getMessage().contains("正式发布记录"));
        verify(tasks, never()).update(any());
    }

    @Test
    void lockedManualTimestampDoesNotFreezeWorkOrCreateFormalBadge() {
        Task current = new Task();
        current.setId("K1"); current.setWorkspaceId("W1"); current.setReqId("R1");
        current.setBoardColumn("done"); current.setPublishedAt(LocalDate.now());
        when(locks.lockTask("W1", "K1")).thenReturn(current);
        savedUpdateResponse();
        Task result = service.update("U1", "W1", "K1", request());
        assertNull(result.getPublishedAt());
        assertFalse(result.getEverPublished());
        verify(tasks).update(any());
        InOrder order = inOrder(locks);
        order.verify(locks).lockProjects("W1", "R1");
        order.verify(locks).lockTask("W1", "K1");
    }

    @Test
    void incrementalBindingRetainsSuccessfulOtherVersionWithoutReinsertionOrStealing() {
        persistedBindings.put("K1", new ArrayList<String>(Collections.singletonList("V1")));
        when(tasks.selectVersionFormalSuccessIdsForScope("W1", "V1")).thenReturn(Collections.singletonList("VR1"));
        TaskSaveRequest req = request();
        req.setVersionIds(Arrays.asList("V2", "V1", "V2"));
        req.setVersionChangeReason("增加迭代版本，保留首版历史");
        savedUpdateResponse();
        Task result = service.update("U1", "W1", "K1", req);
        assertEquals(Arrays.asList("V1", "V2"), result.getVersionIds());
        verify(bindings).insertBatch("W1", "V2", Collections.singletonList("K1"));
        verify(bindings, never()).insertBatch(eq("W1"), eq("V1"), anyList());
        verify(bindings, never()).deleteBinding(anyString(), anyString(), anyString());
        verify(bindings, never()).deleteByTaskIds(anyString(), anyList());
        verify(bindings, never()).deleteByTaskId(anyString(), anyString());
    }

    private void productionHistory(String taskId) {
        VersionRelease record = new VersionRelease();
        record.setId("VR1"); record.setVersionId("V1"); record.setWorkspaceId("W1");
        record.setResult("success"); record.setEnvironment("production"); record.setOperation("deploy");
        record.setCoverage("full"); record.setTargetKeys(Collections.singletonList("main"));
        record.setOccurredAt(LocalDate.of(2026, 11, 9).atStartOfDay());
        record.setRecordedAt(record.getOccurredAt());
        VersionReleaseItem item = new VersionReleaseItem();
        item.setTaskId(taskId); item.setDisposition("published"); record.setItems(Collections.singletonList(item));
        when(records.selectPublicationRecords(eq("W1"), anyList())).thenReturn(Collections.singletonList(record));
    }

    @Test
    void changedProjectBetweenObservationAndLockFailsWithoutWrongScopeWrites() {
        Task current = new Task();
        current.setReqId("R2");
        when(locks.lockTask("W1", "K1")).thenReturn(current);
        assertEquals(409, assertThrows(AppException.class, () -> update(request())).getCode());
        verify(tasks, never()).update(any());
    }

    @Test
    void optimisticSaveConflictStillRollsBack() {
        TaskSaveRequest req = request();
        req.setOldUpdatedAt(LocalDateTime.now());
        when(tasks.update(any(Task.class))).thenReturn(0);
        assertEquals(409, assertThrows(AppException.class, () -> update(req)).getCode());
    }
}
