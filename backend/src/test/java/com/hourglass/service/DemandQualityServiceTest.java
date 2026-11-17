package com.hourglass.service;

import com.hourglass.dto.DemandCheckRequest;
import com.hourglass.dto.DemandCheckResponse;
import com.hourglass.entity.Demand;
import com.hourglass.mapper.DemandMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 需求提交前体检：只提示不拦截，相似判定排除自身与已关闭需求 */
class DemandQualityServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String PROJECT = "P1";

    private DemandMapper demandMapper;
    private ProjectAccessService projectAccess;
    private DemandQualityService service;

    @BeforeEach
    void setUp() {
        demandMapper = mock(DemandMapper.class);
        projectAccess = mock(ProjectAccessService.class);
        service = new DemandQualityService(demandMapper, projectAccess);
    }

    @Test
    void reportsMissingAcceptanceShortDescriptionAndHighPriorityDate() {
        DemandCheckRequest req = request("支持按项目导出工时报表");
        req.setDescription("财务每月要报表。");
        req.setAcceptText(null);
        req.setPriority("P1");
        req.setExpectDate(null);
        when(demandMapper.selectByReq(WS, PROJECT)).thenReturn(new ArrayList<Demand>());

        DemandCheckResponse res = service.check(WS, USER, req);

        assertEquals(3, res.getIssues().size());
        assertEquals("acceptText", res.getIssues().get(0).getField());
        assertEquals("warn", res.getIssues().get(0).getLevel());
        assertEquals("description", res.getIssues().get(1).getField());
        assertTrue(res.getIssues().get(1).getTitle().contains("8 个字"));
        assertEquals("expectDate", res.getIssues().get(2).getField());
        assertTrue(res.getIssues().get(2).getTitle().startsWith("P1"));
        assertTrue(res.getSimilar().isEmpty());
    }

    @Test
    void completeDemandHasNoIssues() {
        DemandCheckRequest req = request("支持按项目导出工时报表");
        req.setDescription("财务每月需要按项目导出工时，用于对账与成本分摊。");
        req.setAcceptText("可以选择项目和月份，导出包含成员、工时与项目的 CSV。");
        req.setPriority("P1");
        req.setExpectDate(LocalDate.of(2026, 12, 31));
        when(demandMapper.selectByReq(WS, PROJECT)).thenReturn(new ArrayList<Demand>());

        DemandCheckResponse res = service.check(WS, USER, req);

        assertTrue(res.getIssues().isEmpty());
        assertTrue(res.getSimilar().isEmpty());
    }

    @Test
    void findsSimilarOpenDemandAndSkipsClosedAndSelf() {
        DemandCheckRequest req = request("支持按项目导出工时报表");
        req.setExcludeId("D0");
        when(demandMapper.selectByReq(WS, PROJECT)).thenReturn(Arrays.asList(
                demand("D0", "支持按项目导出工时报表", "review"),
                demand("D1", "按项目导出工时明细", "plan"),
                demand("D2", "支持按项目导出工时报表", "closed"),
                demand("D3", "成员负载按测试角色拆分", "pass")
        ));

        DemandCheckResponse res = service.check(WS, USER, req);

        assertEquals(1, res.getSimilar().size());
        DemandCheckResponse.Similar hit = res.getSimilar().get(0);
        assertEquals("D1", hit.getId());
        assertTrue(hit.getScore() >= 60, "相似度应能明确提示重复：" + hit.getScore());
        assertFalse("D0".equals(hit.getId()));
    }

    @Test
    void keepsOnlyTopThreeSimilarDemands() {
        DemandCheckRequest req = request("支持按项目导出工时报表");
        when(demandMapper.selectByReq(WS, PROJECT)).thenReturn(Arrays.asList(
                demand("D1", "按项目导出工时明细", "review"),
                demand("D2", "按项目导出工时汇总", "pass"),
                demand("D3", "按项目导出工时报表", "done"),
                demand("D4", "按项目导出报表工时", "plan")
        ));

        DemandCheckResponse res = service.check(WS, USER, req);

        assertEquals(3, res.getSimilar().size());
        assertTrue(res.getSimilar().get(0).getScore() >= res.getSimilar().get(1).getScore());
        assertTrue(res.getSimilar().get(1).getScore() >= res.getSimilar().get(2).getScore());
    }

    @Test
    void genericSharedWordsDoNotTriggerSimilarity() {
        DemandCheckRequest req = request("支持导出");
        when(demandMapper.selectByReq(WS, PROJECT)).thenReturn(Arrays.asList(
                demand("D1", "支持导入", "review")
        ));

        DemandCheckResponse res = service.check(WS, USER, req);

        assertTrue(res.getSimilar().isEmpty());
    }

    @Test
    void keysUseChineseBigramsAndIgnorePunctuation() {
        Set<String> keys = DemandQualityService.keys("导出、工时 报表 CSV");
        assertTrue(keys.contains("导出"));
        assertTrue(keys.contains("工时"));
        assertTrue(keys.contains("报表"));
        assertTrue(keys.contains("csv"));
        assertFalse(keys.contains("出工"), "标点分段处不生成跨段二元组");
    }

    @Test
    void blankTitleNeverQueriesSimilarDemands() {
        DemandCheckRequest req = request("   ");
        try {
            service.check(WS, USER, req);
            throw new AssertionError("空白标题应被拒绝");
        } catch (com.hourglass.common.AppException expected) {
            assertEquals(400, expected.getCode());
        }
        verify(demandMapper, never()).selectByReq(eq(WS), eq(PROJECT));
    }

    private static DemandCheckRequest request(String title) {
        DemandCheckRequest req = new DemandCheckRequest();
        req.setReqId(PROJECT);
        req.setTitle(title);
        return req;
    }

    private static Demand demand(String id, String title, String status) {
        Demand d = new Demand();
        d.setId(id);
        d.setTitle(title);
        d.setStatus(status);
        d.setPriority("P1");
        return d;
    }
}
