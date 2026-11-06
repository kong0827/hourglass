package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.NotificationPreferenceItem;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class NotificationEventServiceTest {

    private final UserNotificationPreferenceService preferences = mock(UserNotificationPreferenceService.class);
    private final AppNotificationService inApp = mock(AppNotificationService.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final MailDeliveryService deliveries = mock(MailDeliveryService.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final NotificationEventService service = new NotificationEventService(preferences, inApp, users, members, deliveries, projectAccess);

    @Test
    void preferenceControlsBothChannels() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_ASSIGNED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_ASSIGNED, true, true));
        AppUser user = new AppUser();
        user.setEmail("u1@example.com");
        when(users.selectById("U1")).thenReturn(user);

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "assigned", "body", "K1");

        verify(inApp).pushImmediate("U1", "W1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "assigned", "body", "K1");
        verify(deliveries).enqueue("u1@example.com", "assigned", "body",
                UserNotificationPreferenceService.TASK_ASSIGNED, "K1");
    }

    @Test
    void disabledChannelsDoNothing() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_UPDATED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_UPDATED, false, false));

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_UPDATED,
                "updated", "body", "K1");

        verifyNoInteractions(inApp, users, deliveries);
    }

    @Test
    void hiddenProjectDoesNotReceiveNotification() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView("W1", "U1", "R1")).thenReturn(false);

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_UPDATED,
                "updated", "body", "K1", "R1");

        verifyNoInteractions(preferences, inApp, users, deliveries);
    }

    @Test
    void formerWorkspaceMemberDoesNotReceiveWorkspaceContent() {
        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_UPDATED,
                "updated", "body", "K1");

        verifyNoInteractions(preferences, inApp, users, deliveries);
    }

    @Test
    void systemNotificationSkipsMembershipAndPreferenceChecks() {
        AppUser user = new AppUser();
        user.setEmail("u1@example.com");
        when(users.selectById("U1")).thenReturn(user);

        service.notifySystem("U1", "W1", NotificationEventService.MEMBER_REMOVED,
                "removed", "body", null);

        verify(inApp).pushImmediate("U1", "W1", NotificationEventService.MEMBER_REMOVED,
                "removed", "body", null);
        verify(deliveries).enqueue("u1@example.com", "removed", "body",
                NotificationEventService.MEMBER_REMOVED, null);
        verifyNoInteractions(preferences, projectAccess, members);
    }

    @Test
    void emailCarriesTaskDeepLinkWhenBaseUrlConfigured() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "mailBaseUrl", "https://host/hourglass");
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_COMMENT))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_COMMENT, false, true));
        AppUser user = new AppUser();
        user.setEmail("u1@example.com");
        when(users.selectById("U1")).thenReturn(user);

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_COMMENT,
                "comment", "body", "K1");

        org.mockito.ArgumentCaptor<String> body = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(deliveries).enqueue(org.mockito.ArgumentMatchers.eq("u1@example.com"),
                org.mockito.ArgumentMatchers.eq("comment"), body.capture(),
                org.mockito.ArgumentMatchers.eq(UserNotificationPreferenceService.TASK_COMMENT),
                org.mockito.ArgumentMatchers.eq("K1"));
        org.junit.jupiter.api.Assertions.assertTrue(body.getValue()
                .endsWith("打开任务：https://host/hourglass/#/board?task=K1"));
    }

    @Test
    void emailWithoutBaseUrlKeepsPlainBody() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_COMMENT))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_COMMENT, false, true));
        AppUser user = new AppUser();
        user.setEmail("u1@example.com");
        when(users.selectById("U1")).thenReturn(user);

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_COMMENT,
                "comment", "body", "K1");

        verify(deliveries).enqueue("u1@example.com", "comment", "body",
                UserNotificationPreferenceService.TASK_COMMENT, "K1");
    }

    @Test
    void immediateInAppEventsBypassReminderDeduplication() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService notifications = new AppNotificationService(mapper);

        notifications.pushImmediate("U1", "W1", "task_updated", "one", "a", "K1");
        notifications.pushImmediate("U1", "W1", "task_updated", "two", "b", "K1");

        verify(mapper, times(2)).insert(any());
        verify(mapper, never()).countRecent(anyString(), anyString(), anyString(), any());
        verify(mapper, never()).countRecentNoRef(anyString(), anyString(), anyString(), any());
    }
}
