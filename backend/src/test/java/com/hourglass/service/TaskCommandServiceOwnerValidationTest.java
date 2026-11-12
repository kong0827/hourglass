package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.*;
import com.hourglass.mapper.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 任务负责人复用花名册口径；只读可选，历史不变绑定可保存。 */
class TaskCommandServiceOwnerValidationTest {
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper projects = mock(RequirementMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectMemberMapper grants = mock(ProjectMemberMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final DeliveryScopeLock locks = mock(DeliveryScopeLock.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final ProjectAccessService access = new ProjectAccessService(grants, members);
    private final TaskCommandService service = new TaskCommandService(tasks, projects, mock(SubtaskMapper.class),
            mock(CategoryMapper.class), users, mock(RequirementDocMapper.class), mock(DevBranchMapper.class), members,
            mock(ProjectVersionMapper.class), mock(VersionTaskMapper.class), demands,
            mock(WorkspaceMetaCache.class), support, mock(TaskCompletionService.class), mock(TaskWorkflowService.class),
            audit, mock(NotificationEventService.class), access, mock(TimeLogService.class), locks, mock(ReleasePermissionService.class));
    private Task old;
    private WorkspaceMember owner;

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
        old = new Task();
        old.setId("K1"); old.setWorkspaceId("W1"); old.setReqId("P1");
        old.setOwnerUserId("U2"); old.setOwner("开发者"); old.setBoardColumn("backlog");
        when(support.require("W1", "K1")).thenReturn(old);
        when(locks.lockTask("W1", "K1")).thenReturn(old);
        when(tasks.selectById("K1")).thenReturn(old);
        when(tasks.update(any())).thenReturn(1);
        when(audit.diffParts(anyString(), any(), any(), any(), any())).thenReturn(Collections.emptyList());
        when(members.selectDeliveryAccessForUpdate(eq("W1"), eq("U1"), anyString()))
                .thenReturn(Collections.<String, Object>singletonMap("role", "owner"));
        AppUser user = new AppUser(); user.setId("U2"); user.setDisplayName("开发者");
        when(users.selectById("U2")).thenReturn(user);
        owner = new WorkspaceMember(); owner.setUserId("U2"); owner.setWorkspaceId("W1");
        owner.setRole("member"); owner.setProjectAccessMode("assigned");
        when(members.selectMember("W1", "U2")).thenReturn(owner);
        WorkspaceMember operator = new WorkspaceMember(); operator.setUserId("U1"); operator.setRole("owner");
        when(members.selectMember("W1", "U1")).thenReturn(operator);
        for (String id : new String[]{"P1", "P2"}) {
            Requirement p = new Requirement(); p.setId(id); p.setWorkspaceId("W1");
            when(projects.selectById(id)).thenReturn(p);
        }
        grant("P1", "read");
    }

    @Test
    void createCanAssignReadOnlyProjectMember() {
        service.create("U1", "W1", request("P1"));
        ArgumentCaptor<Task> task = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(task.capture());
        assertEquals("U2", task.getValue().getOwnerUserId());
        assertEquals("P1", task.getValue().getReqId());
    }

    @Test
    void createRejectsViewerEvenThoughViewerCanViewProject() {
        owner.setRole("viewer");
        assertThrows(AppException.class, () -> service.create("U1", "W1", request("P1")));
        verify(tasks, never()).insert(any());
    }

    @Test
    void createRejectsNoneAndAssignedWithoutGrant() {
        grant("P1", "none");
        assertThrows(AppException.class, () -> service.create("U1", "W1", request("P1")));
        when(grants.selectOne("W1", "P1", "U2")).thenReturn(null);
        assertThrows(AppException.class, () -> service.create("U1", "W1", request("P1")));
        verify(tasks, never()).insert(any());
    }

    @Test
    void changingProjectRevalidatesUnchangedOwnerAgainstTargetProject() {
        grant("P2", "none");
        assertThrows(AppException.class, () -> service.update("U1", "W1", "K1", request("P2")));
        verify(tasks, never()).update(any());
        verify(grants).selectOne("W1", "P2", "U2");
    }

    @Test
    void changingProjectAllowsReadOnlyTargetOwner() {
        grant("P2", "read");
        service.update("U1", "W1", "K1", request("P2"));
        ArgumentCaptor<Task> task = ArgumentCaptor.forClass(Task.class);
        verify(tasks).update(task.capture());
        assertEquals("P2", task.getValue().getReqId());
    }

    @Test
    void changingOwnerRejectsTargetWithoutVisibility() {
        old.setOwnerUserId("U1");
        grant("P1", "none");
        assertThrows(AppException.class, () -> service.update("U1", "W1", "K1", request("P1")));
        verify(tasks, never()).update(any());
    }

    @Test
    void historicalOwnerAndProjectUnchangedCanSaveAfterGrantRemoved() {
        grant("P1", "none");
        service.update("U1", "W1", "K1", request("P1"));
        verify(tasks).update(any());
        verify(grants, never()).selectOne(anyString(), anyString(), anyString());
    }

    @Test
    void historicalViewerAndDepartedMemberCanSaveUnchangedBinding() {
        owner.setRole("viewer");
        service.update("U1", "W1", "K1", request("P1"));
        when(members.selectMember("W1", "U2")).thenReturn(null);
        service.update("U1", "W1", "K1", request("P1"));
        verify(tasks, times(2)).update(any());
    }

    @Test
    void departedMemberCannotBeMovedToAnotherProject() {
        when(members.selectMember("W1", "U2")).thenReturn(null);
        assertThrows(AppException.class, () -> service.update("U1", "W1", "K1", request("P2")));
        verify(tasks, never()).update(any());
    }

    @Test
    void invalidProjectFailsBeforeTargetPermissionCheck() {
        when(projects.selectById("P2")).thenReturn(null);
        assertThrows(AppException.class, () -> service.update("U1", "W1", "K1", request("P2")));
        verify(grants, never()).selectOne(anyString(), anyString(), anyString());
    }

    @Test
    void demandInferredProjectAlsoValidatesTargetOwner() {
        Demand demand = new Demand(); demand.setId("D1"); demand.setWorkspaceId("W1"); demand.setReqId("P2");
        when(tasks.selectDemandForScope("W1", "D1")).thenReturn(demand);
        when(demands.selectById("D1")).thenReturn(demand);
        grant("P2", "none");
        TaskSaveRequest req = request(null); req.setDemandId("D1");
        assertThrows(AppException.class, () -> service.create("U1", "W1", req));
        verify(grants).selectOne("W1", "P2", "U2");
        verify(tasks, never()).insert(any());
    }

    @Test
    void textOnlyHistoricalOwnerStaysCompatible() {
        TaskSaveRequest req = request("P1"); req.setOwnerUserId(null); req.setOwner("外部历史负责人");
        service.create("U1", "W1", req);
        ArgumentCaptor<Task> task = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(task.capture());
        assertNull(task.getValue().getOwnerUserId());
        assertEquals("外部历史负责人", task.getValue().getOwner());
    }

    private void grant(String projectId, String value) {
        ProjectMember row = new ProjectMember(); row.setAccess(value);
        when(grants.selectOne("W1", projectId, "U2")).thenReturn(row);
    }

    private TaskSaveRequest request(String projectId) {
        TaskSaveRequest req = new TaskSaveRequest(); req.setTitle("任务"); req.setBoardColumn("backlog");
        req.setOwnerUserId("U2"); req.setReqId(projectId);
        return req;
    }
}
