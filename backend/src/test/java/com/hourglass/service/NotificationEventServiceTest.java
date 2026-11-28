package com.hourglass.service;

import com.hourglass.dto.NotificationPreferenceItem;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import com.hourglass.wecom.WeComNotifyService;
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
    private final com.hourglass.mapper.WorkspaceMapper workspaces = mock(com.hourglass.mapper.WorkspaceMapper.class);
    private final WeComNotifyService wecom = mock(WeComNotifyService.class);
    private final NotificationEventService service = new NotificationEventService(preferences, inApp, users, members,
            deliveries, projectAccess, workspaces, wecom);

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
                "assigned", "body", "K1", null, null, null);
        verify(deliveries).enqueue("u1@example.com", "assigned", "body",
                UserNotificationPreferenceService.TASK_ASSIGNED, "K1");
    }

    @Test
    void workspaceInAppSwitchOffKeepsEmailButSkipsNotificationCenter() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_UPDATED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_UPDATED, true, true));
        AppUser user = new AppUser();
        user.setEmail("u1@example.com");
        when(users.selectById("U1")).thenReturn(user);
        com.hourglass.entity.Workspace ws = new com.hourglass.entity.Workspace();
        ws.setNotifyInAppEnabled(Boolean.FALSE);
        when(workspaces.selectById("W1")).thenReturn(ws);

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_UPDATED,
                "updated", "body", "K1");

        verify(deliveries).enqueue("u1@example.com", "updated", "body",
                UserNotificationPreferenceService.TASK_UPDATED, "K1");
        verifyNoInteractions(inApp);
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
                "removed", "body", null, null, null);
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
    void mailOverrideKeepsInAppShortAndEnrichesEmail() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "mailBaseUrl", "https://host/hourglass");
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_ASSIGNED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_ASSIGNED, true, true));
        AppUser user = new AppUser();
        user.setEmail("u1@example.com");
        when(users.selectById("U1")).thenReturn(user);

        service.notifyWithMail("U1", "W1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "任务负责人变更：修复登录超时", "任务「修复登录超时」已指派给你", "K1", null,
                "王五 把「修复登录超时」转派给你",
                "王五 把工作项转派给你：\n\n标题：修复登录超时");

        /* 站内保持一句话，邮件换成带详情的新文案，深链仍追加在邮件末尾 */
        verify(inApp).pushImmediate("U1", "W1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "任务负责人变更：修复登录超时", "任务「修复登录超时」已指派给你", "K1", null, null, null);
        verify(deliveries).enqueue("u1@example.com", "王五 把「修复登录超时」转派给你",
                "王五 把工作项转派给你：\n\n标题：修复登录超时\n\n打开任务：https://host/hourglass/#/board?task=K1",
                UserNotificationPreferenceService.TASK_ASSIGNED, "K1");
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
    void mentionUsesCommentPreferenceButWritesMentionType() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView("W1", "U1", "R1")).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_COMMENT))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_COMMENT, true, false));

        service.notifyMention("U1", "W1", "「Task」提到了你", "body", "K1", "R1");

        /* 偏好仍读评论开关，站内类型写成 task_mention，供「提及我」筛选命中 */
        verify(inApp).pushImmediate("U1", "W1", NotificationEventService.MENTION_TYPE,
                "「Task」提到了你", "body", "K1", null, null, "R1");
        verify(deliveries, never()).enqueue(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void wecomIsIndependentChannelAndSurvivesOffInAppAndEmail() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_ASSIGNED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_ASSIGNED,
                        false, false, true));

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "assigned", "body", "K1");

        /* 站内与邮件都关，企微仍按自己的开关入队 */
        verify(wecom).enqueueForUser("W1", "U1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "assigned", "body", "/#/board?task=K1");
        verifyNoInteractions(inApp, users, deliveries);
    }

    @Test
    void wecomSwitchOffSkipsEnqueueWhileInAppStillDelivers() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_ASSIGNED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_ASSIGNED,
                        true, false, false));

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_ASSIGNED,
                "assigned", "body", "K1");

        verify(inApp).pushImmediate(anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), any(), any(), any());
        verifyNoInteractions(wecom);
    }

    @Test
    void wecomNeverEnqueuesForNonPushableEvents() {
        when(members.selectMember("W1", "U1")).thenReturn(mock(WorkspaceMember.class));
        when(projectAccess.canView(anyString(), anyString(), any())).thenReturn(true);
        when(preferences.get("U1", UserNotificationPreferenceService.TASK_UPDATED))
                .thenReturn(new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_UPDATED,
                        true, false, true));

        service.notify("U1", "W1", UserNotificationPreferenceService.TASK_UPDATED,
                "updated", "body", "K1");

        verifyNoInteractions(wecom);
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
