package com.hourglass.service;

import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Category;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class TaskCommandServiceNotificationTest {

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final CategoryMapper categories = mock(CategoryMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final TaskSupport support = mock(TaskSupport.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final TaskCommandService service = new TaskCommandService(tasks, mock(RequirementMapper.class),
            mock(SubtaskMapper.class), categories, users, mock(RequirementDocMapper.class),
            mock(DevBranchMapper.class), members, mock(ProjectVersionMapper.class),
            mock(VersionTaskMapper.class), mock(DemandMapper.class), mock(WorkspaceMetaCache.class),
            support, mock(TaskCompletionService.class), mock(TaskWorkflowService.class), audit, events,
            mock(ProjectAccessService.class));

    @Test
    void createWithBoundOwnerCreatesAssignedEvent() {
        TaskSaveRequest req = request("U2");
        AppUser owner = new AppUser();
        owner.setId("U2");
        owner.setDisplayName("owner");
        when(users.selectById("U2")).thenReturn(owner);
        when(members.selectMember("W1", "U2")).thenReturn(mock(WorkspaceMember.class));
        when(categories.selectByName("W1", "general")).thenReturn(new Category());
        when(tasks.selectById(anyString())).thenReturn(oldTask("U2"));

        service.create("U1", "W1", req);

        verify(events).notify(eq("U2"), eq("W1"), eq(UserNotificationPreferenceService.TASK_ASSIGNED),
                eq("新任务指派：new title"), anyString(), anyString(), isNull());
    }

    @Test
    void ownerChangeWithOtherFieldsCreatesOnlyOneAssignedEvent() {
        Task old = oldTask("U1");
        TaskSaveRequest req = request("U2");
        prepareUpdate(old, req);
        when(members.selectMember("W1", "U2")).thenReturn(mock(WorkspaceMember.class));

        service.update("U3", "W1", "K1", req);

        verify(events).notify(eq("U2"), eq("W1"), eq(UserNotificationPreferenceService.TASK_ASSIGNED),
                anyString(), anyString(), eq("K1"), isNull());
        verifyNoMoreInteractions(events);
    }

    @Test
    void createForSelfDoesNotNotifySelf() {
        TaskSaveRequest req = request("U1");
        AppUser owner = new AppUser();
        owner.setId("U1");
        owner.setDisplayName("owner");
        when(users.selectById("U1")).thenReturn(owner);
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(categories.selectByName("W1", "general")).thenReturn(new Category());
        when(tasks.selectById(anyString())).thenReturn(oldTask("U1"));

        service.create("U1", "W1", req);

        verifyNoInteractions(events);
    }

    @Test
    void ownerChangeToSelfDoesNotNotifySelf() {
        Task old = oldTask("U2");
        TaskSaveRequest req = request("U1");
        prepareUpdate(old, req);
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));

        service.update("U1", "W1", "K1", req);

        verifyNoInteractions(events);
    }

    @Test
    void ordinaryUpdateNotifiesCurrentOwnerWithMergedChanges() {
        Task old = oldTask("U1");
        TaskSaveRequest req = request("U1");
        prepareUpdate(old, req);

        service.update("U2", "W1", "K1", req);

        verify(events).notify(eq("U1"), eq("W1"), eq(UserNotificationPreferenceService.TASK_UPDATED),
                eq("任务更新：new title"), eq("标题；截止日期"), eq("K1"), isNull());
    }

    @Test
    void ordinaryUpdateByOwnerDoesNotNotifySelf() {
        Task old = oldTask("U1");
        TaskSaveRequest req = request("U1");
        prepareUpdate(old, req);

        service.update("U1", "W1", "K1", req);

        verifyNoInteractions(events);
    }

    @Test
    void columnChangeWithFieldsMergesIntoSingleUpdateEvent() {
        Task old = oldTask("U1");
        TaskSaveRequest req = request("U1");
        req.setBoardColumn("doing");
        prepareUpdate(old, req);
        when(tasks.maxSortOrder("W1", "doing")).thenReturn(1024);
        when(support.columnName("W1", "backlog")).thenReturn("待处理");
        when(support.columnName("W1", "doing")).thenReturn("进行中");

        service.update("U2", "W1", "K1", req);

        verify(events).notify(eq("U1"), eq("W1"), eq(UserNotificationPreferenceService.TASK_UPDATED),
                eq("任务更新：new title"), eq("从「待处理」移动到「进行中」；标题；截止日期"), eq("K1"), isNull());
        verifyNoMoreInteractions(events);
    }

    @Test
    void columnChangeOnlyNotifiesOwnerOfMove() {
        Task old = oldTask("U1");
        TaskSaveRequest req = request("U1");
        req.setBoardColumn("doing");
        prepareUpdate(old, req);
        when(audit.diffParts(eq("W1"), eq(old), any(Task.class), anyList(), any()))
                .thenReturn(new ArrayList<String>());
        when(tasks.maxSortOrder("W1", "doing")).thenReturn(1024);
        when(support.columnName("W1", "backlog")).thenReturn("待处理");
        when(support.columnName("W1", "doing")).thenReturn("进行中");

        service.update("U2", "W1", "K1", req);

        verify(events).notify(eq("U1"), eq("W1"), eq(UserNotificationPreferenceService.TASK_UPDATED),
                eq("任务更新：new title"), eq("从「待处理」移动到「进行中」"), eq("K1"), isNull());
        verifyNoMoreInteractions(events);
    }

    private void prepareUpdate(Task old, TaskSaveRequest req) {
        when(support.require("W1", "K1")).thenReturn(old);
        when(support.tagNames("W1", "K1")).thenReturn(Collections.emptyList());
        when(tasks.selectById("K1")).thenReturn(old);
        AppUser owner = new AppUser();
        owner.setId(req.getOwnerUserId());
        owner.setDisplayName("owner");
        when(users.selectById(req.getOwnerUserId())).thenReturn(owner);
        when(categories.selectByName("W1", "general")).thenReturn(new Category());
        when(audit.diffParts(eq("W1"), eq(old), any(Task.class), anyList(), any()))
                .thenReturn(new ArrayList<String>(Arrays.asList("标题", "截止日期")));
    }

    private TaskSaveRequest request(String ownerId) {
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle("new title");
        req.setOwnerUserId(ownerId);
        req.setOwner("owner");
        req.setCategory("general");
        req.setBoardColumn("backlog");
        req.setPriority("P2");
        req.setProgress(0);
        return req;
    }

    private Task oldTask(String ownerId) {
        Task old = new Task();
        old.setId("K1");
        old.setWorkspaceId("W1");
        old.setTitle("old title");
        old.setOwnerUserId(ownerId);
        old.setOwner("owner");
        old.setBoardColumn("backlog");
        old.setSortOrder(1024);
        old.setIsMilestone(false);
        old.setRemindSent(false);
        old.setItemType("task");
        old.setProgress(0);
        return old;
    }
}
