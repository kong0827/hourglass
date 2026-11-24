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

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class TaskCommandServiceNotificationTest {

    private final DeliveryScopeLock scopeLock = mock(DeliveryScopeLock.class);
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
            mock(ProjectAccessService.class), mock(TimeLogService.class), scopeLock, mock(ReleasePermissionService.class),
            mock(DemandCompletionService.class));

    @org.junit.jupiter.api.BeforeEach
    void setupResponse() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
        when(tasks.update(any(Task.class))).thenReturn(1);
    }

    @Test
    void createWithBoundOwnerCreatesAssignedEvent() {
        TaskSaveRequest req = request("U2");
        AppUser owner = new AppUser();
        owner.setId("U2");
        owner.setDisplayName("owner");
        when(users.selectById("U2")).thenReturn(owner);
        when(members.selectMember("W1", "U2")).thenReturn(mock(WorkspaceMember.class));
        when(tasks.selectById(anyString())).thenReturn(oldTask("U2"));
        when(support.columnName("W1", "backlog")).thenReturn("待处理");

        service.create("U1", "W1", req);

        org.mockito.ArgumentCaptor<String> body = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(events).notifyWithMail(eq("U2"), eq("W1"), eq(UserNotificationPreferenceService.TASK_ASSIGNED),
                eq("新任务指派：new title"), anyString(), anyString(), isNull(),
                contains("给你指派了工作项：new title"), body.capture());
        /* 新建时创建人就是操作人，不再重复「创建：」一行 */
        org.junit.jupiter.api.Assertions.assertTrue(body.getValue().contains("标题：new title"));
        org.junit.jupiter.api.Assertions.assertTrue(body.getValue().contains("类型：任务　优先级：P2　状态：待处理"));
        org.junit.jupiter.api.Assertions.assertFalse(body.getValue().contains("创建："));
    }

    @Test
    void ownerChangeWithOtherFieldsCreatesOnlyOneAssignedEvent() {
        Task old = oldTask("U1");
        TaskSaveRequest req = request("U2");
        prepareUpdate(old, req);
        when(members.selectMember("W1", "U2")).thenReturn(mock(WorkspaceMember.class));

        service.update("U3", "W1", "K1", req);

        verify(events).notifyWithMail(eq("U2"), eq("W1"), eq(UserNotificationPreferenceService.TASK_ASSIGNED),
                eq("任务负责人变更：new title"), anyString(), eq("K1"), isNull(),
                contains("转派给你"), contains("把工作项转派给你"));
        verifyNoMoreInteractions(events);
    }

    @Test
    void transferMailCarriesActorSnapshotAndCreator() {
        Task old = oldTask("U1");
        old.setItemNo(24);
        old.setCreatedByUserId("U9");
        old.setCreatedAt(LocalDateTime.of(2026, 11, 19, 14, 32));
        TaskSaveRequest req = request("U2");
        req.setPriority("P0");
        req.setDueDate(LocalDate.of(2026, 11, 24));
        req.setDescription("<p>支付回调 <b>30 秒</b>无响应</p>");
        prepareUpdate(old, req);
        when(members.selectMember("W1", "U2")).thenReturn(mock(WorkspaceMember.class));
        when(support.columnName("W1", "backlog")).thenReturn("待处理");
        when(users.selectById("U3")).thenReturn(user("U3", "王五"));
        when(users.selectById("U9")).thenReturn(user("U9", "李四"));

        service.update("U3", "W1", "K1", req);

        org.mockito.ArgumentCaptor<String> subject = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.ArgumentCaptor<String> body = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(events).notifyWithMail(eq("U2"), eq("W1"), eq(UserNotificationPreferenceService.TASK_ASSIGNED),
                eq("任务负责人变更：new title"), eq("任务「new title」已指派给你"), eq("K1"), isNull(),
                subject.capture(), body.capture());
        org.junit.jupiter.api.Assertions.assertEquals("王五 把「new title」转派给你", subject.getValue());
        String text = body.getValue();
        org.junit.jupiter.api.Assertions.assertTrue(text.startsWith("王五 把工作项转派给你："));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("项目：未归属项目"));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("标题：new title"));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("编号：WI-024"));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("类型：任务　优先级：P0　状态：待处理"));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("截止：2026-11-24"));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("创建：李四 · 2026-11-19 14:32"));
        org.junit.jupiter.api.Assertions.assertTrue(text.contains("描述：支付回调 30 秒无响应"));
    }

    @Test
    void createForSelfDoesNotNotifySelf() {
        TaskSaveRequest req = request("U1");
        AppUser owner = new AppUser();
        owner.setId("U1");
        owner.setDisplayName("owner");
        when(users.selectById("U1")).thenReturn(owner);
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
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
        when(scopeLock.lockTask("W1", "K1")).thenReturn(old);
        when(support.tagNames("W1", "K1")).thenReturn(Collections.emptyList());
        when(tasks.selectById("K1")).thenReturn(old);
        AppUser owner = new AppUser();
        owner.setId(req.getOwnerUserId());
        owner.setDisplayName("owner");
        when(users.selectById(req.getOwnerUserId())).thenReturn(owner);
        when(audit.diffParts(eq("W1"), eq(old), any(Task.class), anyList(), any()))
                .thenReturn(new ArrayList<String>(Arrays.asList("标题", "截止日期")));
    }

    private AppUser user(String id, String name) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setDisplayName(name);
        return u;
    }

    private TaskSaveRequest request(String ownerId) {
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle("new title");
        req.setOwnerUserId(ownerId);
        req.setOwner("owner");
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
