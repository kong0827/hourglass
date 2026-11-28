package com.hourglass.service;

import com.hourglass.entity.Requirement;
import com.hourglass.mapper.MyWorkMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TestBenchMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 测试工作台汇总：可见项目过滤（归档剔除）、空空间零值、聚合与我的待办同口径。 */
class TestBenchServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final TestBenchMapper benchMapper = mock(TestBenchMapper.class);
    private final RequirementMapper requirementMapper = mock(RequirementMapper.class);
    private final MyWorkMapper myWorkMapper = mock(MyWorkMapper.class);
    private final TestBenchService service = new TestBenchService(benchMapper, requirementMapper, myWorkMapper);

    private static Requirement project(String id, boolean archived) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setArchivedAt(archived ? LocalDateTime.now() : null);
        return r;
    }

    @Test
    void emptyWorkspaceReturnsZerosWithoutAggregateQueries() {
        when(requirementMapper.countVisible(WS, USER)).thenReturn(0);
        when(myWorkMapper.countMyTestPlans(WS, USER)).thenReturn(0);

        Map<String, Object> res = service.summary(WS, USER);

        assertEquals(0, ((Map<?, ?>) res.get("cases")).get("total"));
        assertEquals(0, ((Map<?, ?>) res.get("plans")).get("total"));
        assertEquals(0, ((Map<?, ?>) res.get("bugs")).get("total"));
        assertTrue(((List<?>) res.get("activePlans")).isEmpty());
        assertTrue(((List<?>) res.get("donePlans")).isEmpty());
        verify(benchMapper, never()).caseCounts(anyString(), anyList());
        verify(benchMapper, never()).planCounts(anyString(), anyList());
        verify(benchMapper, never()).countBugs(anyString(), anyList());
    }

    @Test
    @SuppressWarnings("unchecked")
    void summaryAggregatesVisibleProjectsOnlyAndSkipsArchived() {
        when(requirementMapper.countVisible(WS, USER)).thenReturn(2);
        /* R2 已归档：不进入聚合范围 */
        when(requirementMapper.selectPage(eq(WS), eq(USER), eq(0), eq(2)))
                .thenReturn(Arrays.asList(project("R1", false), project("R2", true)));
        List<String> visible = Collections.singletonList("R1");

        Map<String, Object> caseCounts = new java.util.LinkedHashMap<String, Object>();
        caseCounts.put("total", 10L);
        caseCounts.put("passed", 6L);
        caseCounts.put("failed", 2L);
        caseCounts.put("blocked", 0L);
        caseCounts.put("untested", 2L);
        when(benchMapper.caseCounts(WS, visible)).thenReturn(caseCounts);

        Map<String, Object> planCounts = new java.util.LinkedHashMap<String, Object>();
        planCounts.put("total", 3L);
        planCounts.put("running", 1L);
        planCounts.put("done", 1L);
        when(benchMapper.planCounts(WS, visible)).thenReturn(planCounts);

        com.hourglass.dto.MyTestPlanRow active = new com.hourglass.dto.MyTestPlanRow();
        active.setId("P1");
        active.setName("回归一轮");
        active.setCaseCount(8);
        active.setExecutedCount(5);
        when(benchMapper.selectActivePlans(eq(WS), eq(visible), anyInt()))
                .thenReturn(Collections.singletonList(active));
        when(benchMapper.selectDonePlans(eq(WS), eq(visible), anyInt()))
                .thenReturn(Collections.singletonList(active));
        when(benchMapper.countBugs(WS, visible)).thenReturn(4);

        when(myWorkMapper.countMyTestPlans(WS, USER)).thenReturn(1);
        when(myWorkMapper.selectMyTestPlans(eq(WS), eq(USER), eq(0), eq(5)))
                .thenReturn(Collections.singletonList(active));

        Map<String, Object> res = service.summary(WS, USER);

        assertEquals(10L, ((Map<?, ?>) res.get("cases")).get("total"));
        assertEquals(3L, ((Map<?, ?>) res.get("plans")).get("total"));
        assertEquals(4, ((Map<?, ?>) res.get("bugs")).get("total"));
        Map<?, ?> mine = (Map<?, ?>) res.get("mine");
        assertEquals(1, mine.get("total"));
        List<Map<String, Object>> mineItems = (List<Map<String, Object>>) mine.get("items");
        assertEquals(1, mineItems.size());
        assertEquals("P1", mineItems.get(0).get("id"));
        assertEquals(8, mineItems.get(0).get("caseCount"));
        List<Map<String, Object>> activePlans = (List<Map<String, Object>>) res.get("activePlans");
        assertEquals("回归一轮", activePlans.get(0).get("name"));
        assertTrue(res.get("updatedAt") != null);
    }
}
