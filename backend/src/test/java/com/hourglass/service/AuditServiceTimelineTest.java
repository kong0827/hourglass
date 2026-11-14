package com.hourglass.service;

import com.hourglass.dto.EntityTimelineItem;
import com.hourglass.entity.AuditLog;
import com.hourglass.mapper.AuditLogMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 测试域实体时间线：审计行 → 前端可读条目 */
class AuditServiceTimelineTest {

    private static final String WS = "W1";

    private final AuditLogMapper mapper = mock(AuditLogMapper.class);
    private final AuditService service = new AuditService(mapper);

    @Test
    void mapsRowsWithChineseLabelsAndKeepsFailures() {
        LocalDateTime at = LocalDateTime.of(2026, 11, 14, 16, 41);
        when(mapper.selectByTarget(WS, "test_plan", "TP1", 100))
                .thenReturn(Arrays.asList(row("test_plan_run", "张伟", "success", at),
                        row("test_plan_run", "周敏", "fail", at.minusMinutes(5))));

        List<EntityTimelineItem> items = service.timeline(WS, "test_plan", "TP1", 100);

        assertEquals(2, items.size());
        assertEquals("计划批量执行", items.get(0).getActionLabel());
        assertEquals("success", items.get(0).getResult());
        assertEquals(at, items.get(0).getCreatedAt());
        assertEquals("fail", items.get(1).getResult());
        assertEquals("张伟", items.get(0).getActorName());
    }

    @Test
    void clampsLimitToAtMost200() {
        service.timeline(WS, "test_case", "C1", 5000);
        verify(mapper).selectByTarget(WS, "test_case", "C1", 200);
    }

    @Test
    void unknownActionKeepsRawNameInsteadOfBlank() {
        when(mapper.selectByTarget(WS, "test_case", "C1", 100))
                .thenReturn(Arrays.asList(row("future_action", "系统", "success", LocalDateTime.now())));

        assertEquals("future_action", service.timeline(WS, "test_case", "C1", 100).get(0).getActionLabel());
    }

    @Test
    void teamAiConfigChangeHasReadableLabel() {
        when(mapper.selectByTarget(WS, "ai_shared_setting", "platform", 100))
                .thenReturn(Arrays.asList(row("ai_shared_config_update", "管理员", "success", LocalDateTime.now())));

        assertEquals("修改团队 AI 配置",
                service.timeline(WS, "ai_shared_setting", "platform", 100).get(0).getActionLabel());
    }

    private static AuditLog row(String action, String actor, String result, LocalDateTime at) {
        AuditLog a = new AuditLog();
        a.setId(1L);
        a.setWorkspaceId(WS);
        a.setAction(action);
        a.setActorName(actor);
        a.setDetail("测试计划相关操作");
        a.setResult(result);
        a.setCreatedAt(at);
        return a;
    }
}
