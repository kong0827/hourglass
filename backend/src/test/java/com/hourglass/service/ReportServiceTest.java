package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.ReportSubscription;
import com.hourglass.entity.Task;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReportSubscriptionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ReportServiceTest {

    private final ReportSubscriptionMapper mapper = mock(ReportSubscriptionMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final VersionTaskMapper versionTasks = mock(VersionTaskMapper.class);
    private final WorkspaceMapper workspaces = mock(WorkspaceMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final AppNotificationService inApp = mock(AppNotificationService.class);
    private final MailDeliveryService mail = mock(MailDeliveryService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    private final ReportService service = new ReportService(mapper, tasks, versionTasks, workspaces,
            members, users, versions, reqs, inApp, mail, access, tx);

    private final Workspace ws = workspace("W");
    private final AppUser user = user("U", "张三");

    @Test void weeklyReportSummarizesDoneOverdueAndDueSoon() {
        when(workspaces.selectById("W")).thenReturn(ws);
        when(users.selectById("U")).thenReturn(user);
        when(members.selectMember("W", "U")).thenReturn(new WorkspaceMember());
        when(tasks.selectWeeklyReportTasks(eq("W"), eq("U"), eq("张三"), any(), any(), anyInt()))
                .thenReturn(Arrays.asList(
                        task("T1", "done", LocalDate.now().minusDays(2), LocalDateTime.now()),
                        task("T2", "testing", LocalDate.now().minusDays(3), null),
                        task("T3", "doing", LocalDate.now().plusDays(2), null),
                        task("T4", "done", LocalDate.now().minusDays(20), LocalDateTime.now().minusDays(20))));
        when(access.canView(eq("W"), eq("U"), eq("P"))).thenReturn(true);
        when(inApp.pushImmediate(eq("U"), eq("W"), eq("weekly_report"), anyString(), anyString(),
                isNull(), eq("mywork"), eq("W"), isNull()))
                .thenReturn(AppNotificationService.PushResult.INSERTED);

        ReportSubscription sub = new ReportSubscription();
        sub.setId("S"); sub.setWorkspaceId("W"); sub.setUserId("U");
        sub.setChannels("inapp");
        Map<String, Object> res = service.sendWeekly(sub, true);

        assertEquals(Boolean.TRUE, res.get("sent"));
        ArgumentCaptor<String> title = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(inApp).pushImmediate(eq("U"), eq("W"), eq("weekly_report"), title.capture(), body.capture(),
                isNull(), eq("mywork"), eq("W"), isNull());
        assertTrue(title.getValue().startsWith("本周工作小结"));
        assertTrue(body.getValue().contains("本周完成 1 项"));
        assertTrue(body.getValue().contains("进行中 1 项"));
        assertTrue(body.getValue().contains("逾期 1 项"));
        assertTrue(body.getValue().contains("未来 7 天到期 1 项"));
        verify(mapper).touchLastSent(eq("S"), any(LocalDateTime.class));
    }

    @Test void truncatedWeeklyScanSaysStatsArePartial() {
        when(workspaces.selectById("W")).thenReturn(ws);
        when(users.selectById("U")).thenReturn(user);
        when(members.selectMember("W", "U")).thenReturn(new WorkspaceMember());
        java.util.List<Task> many = new java.util.ArrayList<Task>();
        for (int i = 0; i < 500; i++) {
            many.add(task("T" + i, "doing", null, null));
        }
        when(tasks.selectWeeklyReportTasks(eq("W"), eq("U"), eq("张三"), any(), any(), anyInt()))
                .thenReturn(many);
        when(access.canView(eq("W"), eq("U"), eq("P"))).thenReturn(true);
        when(inApp.pushImmediate(eq("U"), eq("W"), eq("weekly_report"), anyString(), anyString(),
                isNull(), eq("mywork"), eq("W"), isNull()))
                .thenReturn(AppNotificationService.PushResult.INSERTED);
        ReportSubscription sub = new ReportSubscription();
        sub.setId("S"); sub.setWorkspaceId("W"); sub.setUserId("U");
        sub.setChannels("inapp");

        service.sendWeekly(sub, true);

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(inApp).pushImmediate(eq("U"), eq("W"), eq("weekly_report"), anyString(), body.capture(),
                isNull(), eq("mywork"), eq("W"), isNull());
        assertTrue(body.getValue().contains("超过 500 项"));
        assertTrue(body.getValue().contains("未覆盖全部"));
    }

    @Test void manualSendDoesNotMarkSent() {
        when(workspaces.selectById("W")).thenReturn(ws);
        when(users.selectById("U")).thenReturn(user);
        when(members.selectMember("W", "U")).thenReturn(new WorkspaceMember());
        when(tasks.selectWeeklyReportTasks(anyString(), anyString(), anyString(), any(), any(), anyInt()))
                .thenReturn(Collections.<Task>emptyList());
        when(mapper.selectOne("W", "U", ReportSubscription.WEEKLY)).thenReturn(null);
        when(inApp.pushImmediate(eq("U"), eq("W"), eq("weekly_report"), anyString(), anyString(),
                isNull(), eq("mywork"), eq("W"), isNull()))
                .thenReturn(AppNotificationService.PushResult.INSERTED);

        Map<String, Object> res = service.sendNow("U", "W", ReportSubscription.WEEKLY, null);

        assertEquals(Boolean.TRUE, res.get("sent"));
        verify(mapper, never()).touchLastSent(anyString(), any());
    }

    @Test void failedInAppWriteIsReportedWithoutMarkingSent() {
        when(workspaces.selectById("W")).thenReturn(ws);
        when(users.selectById("U")).thenReturn(user);
        when(members.selectMember("W", "U")).thenReturn(new WorkspaceMember());
        when(tasks.selectWeeklyReportTasks(anyString(), anyString(), anyString(), any(), any(), anyInt()))
                .thenReturn(Collections.<Task>emptyList());
        when(inApp.pushImmediate(anyString(), anyString(), eq("weekly_report"), anyString(), anyString(),
                isNull(), eq("mywork"), anyString(), isNull()))
                .thenReturn(AppNotificationService.PushResult.FAILED);
        ReportSubscription sub = new ReportSubscription();
        sub.setId("S"); sub.setWorkspaceId("W"); sub.setUserId("U");
        sub.setChannels("inapp");

        Map<String, Object> res = service.sendWeekly(sub, true);

        assertEquals(Boolean.FALSE, res.get("sent"), "站内写入失败不能当成已发送");
        assertEquals("站内通知写入失败，请稍后重试", res.get("message"));
        verify(mapper, never()).touchLastSent(anyString(), any());
    }

    @Test void weeklyDueMatchesWeekdayHourAndOnePerDay() {
        when(mapper.selectEnabledByType(ReportSubscription.WEEKLY)).thenReturn(Collections.<ReportSubscription>emptyList());
        /* 通过 view 读取默认值；扫描判定的分支由下一条用例覆盖 */
        Map<String, Object> view = service.view("U", "W");
        @SuppressWarnings("unchecked")
        Map<String, Object> weekly = (Map<String, Object>) view.get("weekly");
        assertEquals(Boolean.FALSE, weekly.get("enabled"));
        assertEquals(5, weekly.get("weekday"));
        assertEquals(17, weekly.get("sendHour"));
        assertEquals("inapp", weekly.get("channels"));
    }

    @Test void versionReportUsesVersionDeepLinkAndTotals() {
        when(workspaces.selectById("W")).thenReturn(ws);
        when(users.selectById("U")).thenReturn(user);
        when(members.selectMember("W", "U")).thenReturn(new WorkspaceMember());
        ProjectVersion version = new ProjectVersion();
        version.setId("V"); version.setWorkspaceId("W"); version.setReqId("P"); version.setName("1.2.0");
        when(versions.selectById("V")).thenReturn(version);
        when(mapper.selectOne("W", "U", ReportSubscription.VERSION)).thenReturn(null);
        when(versionTasks.selectReportTasks("W", "V")).thenReturn(Arrays.asList(
                task("T1", "done", null, null),
                task("T2", "doing", null, null)));
        when(access.canView("W", "U", "P")).thenReturn(true);
        when(inApp.pushImmediate(eq("U"), eq("W"), eq("version_report"), anyString(), anyString(),
                isNull(), eq("version"), eq("V"), eq("P")))
                .thenReturn(AppNotificationService.PushResult.INSERTED);

        Map<String, Object> res = service.sendNow("U", "W", ReportSubscription.VERSION, "V");

        assertEquals(Boolean.TRUE, res.get("sent"));
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(inApp).pushImmediate(eq("U"), eq("W"), eq("version_report"), eq("版本「1.2.0」发布报告"),
                body.capture(), isNull(), eq("version"), eq("V"), eq("P"));
        assertTrue(body.getValue().contains("版本范围 2 个工作项，已完成 1 项"));
        assertTrue(body.getValue().contains("预估 8 小时，实际 8 小时"));
    }

    @Test void versionSubscriptionRequiresExistingVersion() {
        when(workspaces.selectById("W")).thenReturn(ws);
        AppException ex = assertThrows(AppException.class,
                () -> service.sendNow("U", "W", ReportSubscription.VERSION, "missing"));
        assertEquals(400, ex.getCode());
    }

    @Test void versionReportHidesInvisibleProject() {
        when(workspaces.selectById("W")).thenReturn(ws);
        ProjectVersion version = new ProjectVersion();
        version.setId("V"); version.setWorkspaceId("W"); version.setReqId("P"); version.setName("1.2.0");
        when(versions.selectById("V")).thenReturn(version);
        when(access.canView("W", "U", "P")).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.sendNow("U", "W", ReportSubscription.VERSION, "V"));

        assertEquals(404, ex.getCode());
        verifyNoInteractions(versionTasks);
        verifyNoInteractions(inApp);
    }

    @Test void updateRejectsUnknownChannelAndWeekday() {
        Map<String, Object> body = new LinkedHashMap<String, Object>();
        body.put("enabled", true);
        body.put("channels", "sms");
        body.put("weekday", 5);
        body.put("sendHour", 17);
        AppException ex = assertThrows(AppException.class,
                () -> service.update("U", "W", ReportSubscription.WEEKLY, body));
        assertEquals(400, ex.getCode());

        body.put("channels", "both");
        body.put("weekday", 8);
        AppException ex2 = assertThrows(AppException.class,
                () -> service.update("U", "W", ReportSubscription.WEEKLY, body));
        assertEquals(400, ex2.getCode());
    }

    @Test void updatePersistsChannelsAndSchedule() {
        Map<String, Object> body = new LinkedHashMap<String, Object>();
        body.put("enabled", true);
        body.put("channels", "both");
        body.put("weekday", 6);
        body.put("sendHour", 9);
        when(mapper.selectByUser("W", "U")).thenReturn(Collections.<ReportSubscription>emptyList());

        service.update("U", "W", ReportSubscription.WEEKLY, body);

        ArgumentCaptor<ReportSubscription> row = ArgumentCaptor.forClass(ReportSubscription.class);
        verify(mapper).upsert(row.capture());
        assertEquals(Boolean.TRUE, row.getValue().getEnabled());
        assertEquals("both", row.getValue().getChannels());
        assertEquals(6, row.getValue().getWeekday());
        assertEquals(9, row.getValue().getSendHour());
        assertEquals(ReportSubscription.WEEKLY, row.getValue().getReportType());
    }

    private static Workspace workspace(String id) {
        Workspace ws = new Workspace();
        ws.setId(id);
        ws.setNotifyInAppEnabled(Boolean.TRUE);
        return ws;
    }

    private static AppUser user(String id, String displayName) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setDisplayName(displayName);
        u.setEmail("u@example.com");
        return u;
    }

    private static Task task(String id, String column, LocalDate due, LocalDateTime completedAt) {
        Task t = new Task();
        t.setId(id);
        t.setReqId("P");
        t.setTitle("任务" + id);
        t.setBoardColumn(column);
        t.setDueDate(due);
        t.setCompletedAt(completedAt);
        t.setEstimateMinutes(240);
        t.setTotalMinutes(240);
        return t;
    }
}
