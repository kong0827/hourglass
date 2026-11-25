package com.hourglass.service;

import com.hourglass.entity.AppNotification;
import com.hourglass.mapper.AppNotificationMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.InputStream;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AppNotificationServiceTest {

    @Test
    void purgeUsesConfiguredRetainDays() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        ReflectionTestUtils.setField(service, "retainDays", 7);
        LocalDateTime expected = LocalDateTime.now().minusDays(7);

        service.purgeExpired();

        ArgumentCaptor<LocalDateTime> cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(mapper).deleteOlderThan(cutoff.capture());
        assertEquals(expected.toLocalDate(), cutoff.getValue().toLocalDate());
    }

    @Test
    void pushResultDistinguishesInsertFromDedupe() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        when(mapper.countRecent(eq("U1"), eq("T1"), eq("task_remind"), any(LocalDateTime.class))).thenReturn(0);

        assertEquals(AppNotificationService.PushResult.INSERTED,
                service.pushResult("U1", "W1", "task_remind", "提醒", "正文", "T1"));
        verify(mapper).insert(any(AppNotification.class));
    }

    @Test
    void pushResultReportsDedupeWithoutWriting() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        when(mapper.countRecent(eq("U1"), eq("T1"), eq("task_remind"), any(LocalDateTime.class))).thenReturn(1);

        assertEquals(AppNotificationService.PushResult.DEDUPED,
                service.pushResult("U1", "W1", "task_remind", "提醒", "正文", "T1"));
        verify(mapper, never()).insert(any(AppNotification.class));
    }

    @Test
    void pushResultUsesNoRefWindowForWorkspaceLevelNotices() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        when(mapper.countRecentNoRef(eq("W1"), eq("U1"), eq("task_due"), any(LocalDateTime.class))).thenReturn(1);

        assertEquals(AppNotificationService.PushResult.DEDUPED,
                service.pushResult("U1", "W1", "task_due", "今日任务汇总", "正文", null));
        verify(mapper, never()).countRecent(anyString(), anyString(), anyString(), any(LocalDateTime.class));
        verify(mapper, never()).insert(any(AppNotification.class));
    }

    @Test
    void pushResultReportsFailureInsteadOfSwallowingIt() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        when(mapper.countRecent(anyString(), anyString(), anyString(), any(LocalDateTime.class))).thenReturn(0);
        when(mapper.insert(any(AppNotification.class))).thenThrow(new RuntimeException("db down"));

        assertEquals(AppNotificationService.PushResult.FAILED,
                service.pushResult("U1", "W1", "manager_nudge", "催办", "正文", "T1"));
        assertEquals(false, service.push("U1", "W1", "manager_nudge", "催办", "正文", "T1"));
    }

    @Test
    void pushResultTreatsMissingIdentityAsFailure() {
        AppNotificationService service = new AppNotificationService(mock(AppNotificationMapper.class));

        assertEquals(AppNotificationService.PushResult.FAILED,
                service.pushResult(null, "W1", "task_remind", "提醒", "正文", "T1"));
    }

    @Test
    void linkedNotificationStoresTargetProjectAndProjectRefDerivesIt() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);

        service.pushImmediate("U1", "W1", "demand_status", "需求有更新", "正文", null, "demand", "D1", "P1");
        ArgumentCaptor<AppNotification> withReq = ArgumentCaptor.forClass(AppNotification.class);
        verify(mapper).insert(withReq.capture());
        assertEquals("P1", withReq.getValue().getReqId());

        service.pushImmediate("U1", "W1", "project_access", "项目可见范围已调整", "正文", null, "project", "P2");
        ArgumentCaptor<AppNotification> projectRef = ArgumentCaptor.forClass(AppNotification.class);
        verify(mapper, org.mockito.Mockito.times(2)).insert(projectRef.capture());
        assertEquals("P2", projectRef.getAllValues().get(1).getReqId(), "项目类深链按 refId 归属项目");
    }

    @Test
    void typeCountsReadsFullServerAggregation() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        java.util.List<Map<String, Object>> rows = new java.util.ArrayList<Map<String, Object>>();
        Map<String, Object> a = new HashMap<String, Object>();
        a.put("type", "task_remind");
        a.put("cnt", 7L);
        Map<String, Object> b = new HashMap<String, Object>();
        b.put("type", "demand_status");
        b.put("cnt", 2L);
        rows.add(a);
        rows.add(b);
        when(mapper.countByType(eq("U1"), eq("W1"), eq("unread"))).thenReturn(rows);

        Map<String, Integer> counts = service.typeCounts("U1", "W1", "unread");

        assertEquals(Integer.valueOf(7), counts.get("task_remind"));
        assertEquals(Integer.valueOf(2), counts.get("demand_status"));
    }

    @Test
    void visibilityFilterAlsoChecksPersistedProject() throws Exception {
        Configuration cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String file = "mapper/AppNotificationMapper.xml";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(in);
            new XMLMapperBuilder(in, cfg, file, cfg.getSqlFragments()).parse();
        }
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("userId", "U1");
        params.put("workspaceId", "W1");
        params.put("filter", "all");
        String sql = cfg.getMappedStatement("com.hourglass.mapper.AppNotificationMapper.selectByUser")
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertTrue(sql.contains("pmr.project_id = n.req_id"),
                "非任务通知必须按持久化的 req_id 过滤项目可见性");
        assertTrue(sql.contains("n.req_id"), sql);
        /* 权限调整的告知本身不能随项目隐藏：否则用户在项目消失后看不到任何解释 */
        assertTrue(sql.contains("n.type = 'project_access'"), sql);
    }

    @Test
    void mentionFilterCoversNewTypeAndLegacyTitles() throws Exception {
        Configuration cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String file = "mapper/AppNotificationMapper.xml";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(in);
            new XMLMapperBuilder(in, cfg, file, cfg.getSqlFragments()).parse();
        }
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("userId", "U1");
        params.put("workspaceId", "W1");
        params.put("filter", "mention");
        params.put("offset", 0);
        params.put("limit", 20);
        String sql = cfg.getMappedStatement("com.hourglass.mapper.AppNotificationMapper.selectByUser")
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
        /* 新数据按类型命中，老数据按标题后缀命中；两者缺一都会让「提及我」漏通知 */
        assertTrue(sql.contains("n.type = 'task_mention'"), sql);
        assertTrue(sql.contains("n.type = 'task_comment' AND n.title LIKE '%」提到了你'"), sql);

        params.put("filter", "all");
        String all = cfg.getMappedStatement("com.hourglass.mapper.AppNotificationMapper.selectByUser")
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertFalse(all.contains("task_mention"), "全部页签不应被提及过滤条件限制");
    }
}
