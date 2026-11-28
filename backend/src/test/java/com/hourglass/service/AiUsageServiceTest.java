package com.hourglass.service;

import com.hourglass.dto.AiUsage;
import com.hourglass.mapper.AiUsageMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 用量只累加计数与 token，看板按天汇总并限制查询天数 */
class AiUsageServiceTest {

    private final AiUsageMapper mapper = mock(AiUsageMapper.class);
    private final AiUsageService service = new AiUsageService(mapper);

    @Test
    void recordWritesCountsAndTreatsMissingUsageAsZero() {
        ReflectionTestUtils.setField(service, "enabled", true);
        AiUsage usage = new AiUsage();
        usage.setPromptTokens(10);
        usage.setCompletionTokens(20);

        service.record("W1", "query:overdue", usage, true, 120);
        verify(mapper).record(eq("W1"), eq(LocalDate.now()), eq("query:overdue"), eq(0), eq(10), eq(20), eq(120L));

        service.record("W1", "error", null, false, 30);
        verify(mapper).record(eq("W1"), eq(LocalDate.now()), eq("error"), eq(1), eq(0), eq(0), eq(30L));
    }

    @Test
    void recordDoesNothingWhenDisabledOrWithoutWorkspace() {
        service.record("W1", "answer", null, true, 10);
        ReflectionTestUtils.setField(service, "enabled", true);
        service.record(null, "answer", null, true, 10);
        verifyNoInteractions(mapper);
    }

    @Test
    void dashboardAggregatesTotalsAndClampsDays() {
        when(mapper.daily(eq("W1"), any(LocalDate.class))).thenReturn(Arrays.asList(
                row("2026-11-27", 3, 1, 100, 50, 3000),
                row("2026-11-28", 5, 0, 200, 100, 5000)));
        Map<String, Object> top = new HashMap<String, Object>();
        top.put("intent", "query:overdue");
        top.put("calls", 6);
        top.put("failures", 1);
        top.put("tokens", 300);
        when(mapper.topIntents(eq("W1"), any(LocalDate.class), eq(8)))
                .thenReturn(Collections.singletonList(top));

        Map<String, Object> out = service.dashboard("W1", 90);

        assertEquals(30, out.get("days"));
        assertEquals(LocalDate.now().minusDays(29).toString(), out.get("from"));
        Map<?, ?> totals = (Map<?, ?>) out.get("totals");
        assertEquals(8L, totals.get("calls"));
        assertEquals(1L, totals.get("failures"));
        assertEquals(450L, totals.get("tokens"));
        assertEquals(1000L, totals.get("avgMs"));
        assertEquals(87.5, totals.get("successRatePct"));
        List<?> daily = (List<?>) out.get("daily");
        Map<?, ?> first = (Map<?, ?>) daily.get(0);
        assertEquals("2026-11-27", first.get("day"));
        assertEquals(150L, ((Number) first.get("promptTokens")).longValue()
                + ((Number) first.get("completionTokens")).longValue());
        assertEquals("query:overdue", ((Map<?, ?>) ((List<?>) out.get("top")).get(0)).get("intent"));
    }

    @Test
    void dashboardWithNoCallsLeavesRatesEmpty() {
        when(mapper.daily(eq("W1"), any(LocalDate.class))).thenReturn(Collections.<Map<String, Object>>emptyList());
        when(mapper.topIntents(eq("W1"), any(LocalDate.class), eq(8)))
                .thenReturn(Collections.<Map<String, Object>>emptyList());

        Map<String, Object> out = service.dashboard("W1", null);

        Map<?, ?> totals = (Map<?, ?>) out.get("totals");
        assertEquals(7, out.get("days"));
        assertEquals(0L, totals.get("calls"));
        assertEquals(0L, totals.get("avgMs"));
        assertNull(totals.get("successRatePct"));
    }

    private static Map<String, Object> row(String day, int calls, int failures, int prompt, int completion, long totalMs) {
        Map<String, Object> m = new HashMap<String, Object>();
        m.put("day", day);
        m.put("calls", calls);
        m.put("failures", failures);
        m.put("prompt_tokens", prompt);
        m.put("completion_tokens", completion);
        m.put("total_ms", totalMs);
        return m;
    }
}
