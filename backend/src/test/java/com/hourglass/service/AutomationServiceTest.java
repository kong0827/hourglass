package com.hourglass.service;

import com.hourglass.entity.Task;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AutomationServiceTest {

    private final AutomationSettingsService settings = mock(AutomationSettingsService.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final WorkspaceMapper workspaces = mock(WorkspaceMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final UserNotificationPreferenceService preferences = mock(UserNotificationPreferenceService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final AutomationService service = new AutomationService(settings, tasks, workspaces, members, events,
            preferences, access);

    private final Workspace ws = workspace("W");

    @org.junit.jupiter.api.BeforeEach
    void allowDigestChannels() {
        com.hourglass.dto.NotificationPreferenceItem pref = new com.hourglass.dto.NotificationPreferenceItem(
                UserNotificationPreferenceService.DAILY_DIGEST, true, false);
        when(preferences.get(anyString(), eq(UserNotificationPreferenceService.DAILY_DIGEST))).thenReturn(pref);
    }

    @Test void consolidatesOverdueTasksPerOwnerIntoOneReminder() {
        when(settings.overdueDays("W")).thenReturn(3);
        LocalDate today = LocalDate.now();
        when(tasks.selectAutomationOverdue("W", today.minusDays(3)))
                .thenReturn(Arrays.asList(task("T1", "U", "接口联调", today.minusDays(5)),
                        task("T2", "U", "数据迁移", today.minusDays(4))));
        when(members.selectByWorkspace("W")).thenReturn(Collections.<WorkspaceMember>emptyList());
        when(access.canView("W", "U", "P")).thenReturn(true);
        when(settings.claim("W", AutomationSettingsService.OVERDUE_REMINDER, "owner:U", today)).thenReturn(true);
        when(events.notifySummary(eq("U"), eq("W"), anyString(), eq("task_due"), anyString(),
                anyString(), eq("mywork"), eq("W"), eq(true))).thenReturn(true);

        Map<String, Object> res = service.runForWorkspace(ws);

        assertEquals(1, res.get("notified"));
        assertEquals(2, res.get("taskCount"));
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(events).notifySummary(eq("U"), eq("W"), eq(UserNotificationPreferenceService.DAILY_DIGEST),
                eq("task_due"), eq("逾期提醒：2 项工作项仍未完成"), body.capture(), eq("mywork"), eq("W"),
                eq(true));
        assertTrue(body.getValue().contains("接口联调"));
        assertTrue(body.getValue().contains("逾期 5 天"));
        verify(settings).recordRun(eq("W"), eq(AutomationSettingsService.OVERDUE_REMINDER), contains("提醒 1 人"));
    }

    @Test void secondRunSameDayIsSkippedWithoutSending() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        when(tasks.selectAutomationOverdue("W", today.minusDays(3)))
                .thenReturn(Collections.singletonList(task("T1", "U", "接口联调", today.minusDays(5))));
        when(members.selectByWorkspace("W")).thenReturn(Collections.<WorkspaceMember>emptyList());
        when(access.canView("W", "U", "P")).thenReturn(true);
        when(settings.claim("W", AutomationSettingsService.OVERDUE_REMINDER, "owner:U", today)).thenReturn(false);

        Map<String, Object> res = service.runForWorkspace(ws);

        assertEquals(0, res.get("notified"));
        verifyNoInteractions(events);
        assertEquals("今天已经提醒过，未重复发送", res.get("reason"));
    }

    @Test void ownerWithoutProjectAccessIsNotNotified() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        when(tasks.selectAutomationOverdue("W", today.minusDays(3)))
                .thenReturn(Collections.singletonList(task("T1", "U", "接口联调", today.minusDays(5))));
        when(members.selectByWorkspace("W")).thenReturn(Collections.<WorkspaceMember>emptyList());
        when(access.canView("W", "U", "P")).thenReturn(false);

        Map<String, Object> res = service.runForWorkspace(ws);

        assertEquals(0, res.get("notified"));
        verifyNoInteractions(events);
        verify(settings, never()).claim(anyString(), anyString(), anyString(), any());
    }

    @Test void ownerNameWithoutUserIdFallsBackToMemberDisplayName() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        Task legacy = task("T1", null, "老数据任务", today.minusDays(6));
        legacy.setOwner("张三");
        when(tasks.selectAutomationOverdue("W", today.minusDays(3))).thenReturn(Collections.singletonList(legacy));
        WorkspaceMember member = new WorkspaceMember();
        member.setUserId("U9");
        member.setDisplayName("张三");
        when(members.selectByWorkspace("W")).thenReturn(Collections.singletonList(member));
        when(access.canView("W", "U9", "P")).thenReturn(true);
        when(settings.claim("W", AutomationSettingsService.OVERDUE_REMINDER, "owner:U9", today)).thenReturn(true);
        when(events.notifySummary(eq("U9"), eq("W"), anyString(), eq("task_due"), anyString(),
                anyString(), eq("mywork"), eq("W"), eq(true))).thenReturn(true);

        service.runForWorkspace(ws);

        verify(events).notifySummary(eq("U9"), eq("W"), anyString(), eq("task_due"), anyString(),
                anyString(), eq("mywork"), eq("W"), eq(true));
    }

    @Test void workspaceInAppOffStillSendsEmailReminder() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        when(tasks.selectAutomationOverdue("W", today.minusDays(3)))
                .thenReturn(Collections.singletonList(task("T1", "U", "接口联调", today.minusDays(5))));
        when(members.selectByWorkspace("W")).thenReturn(Collections.<WorkspaceMember>emptyList());
        when(access.canView("W", "U", "P")).thenReturn(true);
        when(settings.claim("W", AutomationSettingsService.OVERDUE_REMINDER, "owner:U", today)).thenReturn(true);
        when(events.notifySummary(eq("U"), eq("W"), anyString(), eq("task_due"), anyString(),
                anyString(), eq("mywork"), eq("W"), eq(false))).thenReturn(true);
        Workspace off = workspace("W");
        off.setNotifyInAppEnabled(Boolean.FALSE);

        Map<String, Object> res = service.runForWorkspace(off);

        assertEquals(1, res.get("notified"));
        verify(events).notifySummary(eq("U"), eq("W"), anyString(), eq("task_due"), anyString(),
                anyString(), eq("mywork"), eq("W"), eq(false));
    }

    @Test void failedDeliveryReleasesClaimSoNextRunRetries() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        when(tasks.selectAutomationOverdue("W", today.minusDays(3)))
                .thenReturn(Collections.singletonList(task("T1", "U", "接口联调", today.minusDays(5))));
        when(members.selectByWorkspace("W")).thenReturn(Collections.<WorkspaceMember>emptyList());
        when(access.canView("W", "U", "P")).thenReturn(true);
        when(settings.claim("W", AutomationSettingsService.OVERDUE_REMINDER, "owner:U", today)).thenReturn(true);
        when(events.notifySummary(eq("U"), eq("W"), anyString(), eq("task_due"), anyString(),
                anyString(), eq("mywork"), eq("W"), eq(true))).thenReturn(false);

        Map<String, Object> res = service.runForWorkspace(ws);

        assertEquals(0, res.get("notified"), "一个渠道都没发出去就不能算提醒过");
        assertEquals(1, res.get("failed"));
        verify(settings).release("W", AutomationSettingsService.OVERDUE_REMINDER, "owner:U", today);
        assertEquals("提醒投递失败，稍后自动重试", res.get("reason"));
        verify(settings).recordRun(eq("W"), eq(AutomationSettingsService.OVERDUE_REMINDER),
                contains("1 人投递失败待重试"));
    }

    @Test void ambiguousDisplayNameIsNotGuessed() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        Task legacy = task("T1", null, "老数据任务", today.minusDays(6));
        legacy.setOwner("张三");
        when(tasks.selectAutomationOverdue("W", today.minusDays(3))).thenReturn(Collections.singletonList(legacy));
        WorkspaceMember a = new WorkspaceMember();
        a.setUserId("U1"); a.setDisplayName("张三");
        WorkspaceMember b = new WorkspaceMember();
        b.setUserId("U2"); b.setDisplayName("张三");
        when(members.selectByWorkspace("W")).thenReturn(Arrays.asList(a, b));

        Map<String, Object> res = service.runForWorkspace(ws);

        assertEquals(0, res.get("notified"));
        verifyNoInteractions(events);
        verify(settings, never()).claim(anyString(), anyString(), anyString(), any());
    }

    @Test void noOverdueTasksRecordsIdleRun() {
        LocalDate today = LocalDate.now();
        when(settings.overdueDays("W")).thenReturn(3);
        when(tasks.selectAutomationOverdue("W", today.minusDays(3))).thenReturn(Collections.<Task>emptyList());

        Map<String, Object> res = service.runForWorkspace(ws);

        assertEquals(0, res.get("notified"));
        verify(settings).recordRun("W", AutomationSettingsService.OVERDUE_REMINDER, "无逾期达到 3 天的工作项");
        verifyNoInteractions(events);
    }

    private static Workspace workspace(String id) {
        Workspace ws = new Workspace();
        ws.setId(id);
        ws.setNotifyInAppEnabled(Boolean.TRUE);
        return ws;
    }

    private static Task task(String id, String ownerUserId, String title, LocalDate due) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId("W");
        t.setReqId("P");
        t.setOwnerUserId(ownerUserId);
        t.setTitle(title);
        t.setDueDate(due);
        t.setBoardColumn("doing");
        return t;
    }
}
