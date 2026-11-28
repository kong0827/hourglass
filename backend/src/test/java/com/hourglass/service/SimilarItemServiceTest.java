package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.SimilarCheckRequest;
import com.hourglass.dto.SimilarCheckResponse;
import com.hourglass.dto.SimilarSourceRow;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 相似条目提示：只读、可见范围、阈值与排序；不调用模型 */
class SimilarItemServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String PROJECT = "P1";

    private final DemandMapper demands = mock(DemandMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final SimilarItemService service = new SimilarItemService(demands, tasks, access);

    @BeforeEach
    void quietMapper() {
        when(demands.selectSimilarSources(anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new ArrayList<SimilarSourceRow>());
        when(tasks.selectSimilarDefects(anyString(), anyString(), anyString(), anyInt()))
                .thenReturn(new ArrayList<SimilarSourceRow>());
    }

    private static SimilarCheckRequest request(String kind, String title) {
        SimilarCheckRequest req = new SimilarCheckRequest();
        req.setKind(kind);
        req.setProjectId(PROJECT);
        req.setTitle(title);
        return req;
    }

    private static SimilarSourceRow row(String id, String title, String status, String statusName,
                                        String projectName, String desc) {
        SimilarSourceRow r = new SimilarSourceRow();
        r.setId(id);
        r.setItemNo(id.endsWith("1") ? 1 : 2);
        r.setTitle(title);
        r.setStatus(status);
        r.setStatusName(statusName);
        r.setProjectId(PROJECT);
        r.setProjectName(projectName);
        r.setDescription(desc);
        return r;
    }

    @Test
    void shortTitleReturnsEmptyWithoutQuery() {
        SimilarCheckResponse res = service.check(USER, WS, request("demand", " 登录 "));

        assertTrue(res.getItems().isEmpty());
        verifyNoInteractions(access, demands, tasks);
    }

    @Test
    void invalidKindRejected() {
        AppException e = assertThrows(AppException.class,
                () -> service.check(USER, WS, request("story", "导出对账单")));
        assertEquals(400, e.getCode());
        verifyNoInteractions(demands, tasks);
    }

    @Test
    void demandCandidatesRankedCappedAndMapped() {
        when(demands.selectSimilarSources(eq(WS), eq(USER), isNull(), anyInt())).thenReturn(Arrays.asList(
                row("D1", "登录白屏", "review", null, "项目甲", "扫码后白屏"),
                row("D2", "对账单导出", "done", null, null, "按月汇总"),
                row("D3", "导出对账单", "pass", null, "项目甲", "选择项目与日期后导出 xlsx"),
                row("D4", "按月导出对账单", "plan", null, "项目乙", "财务对账使用")
        ));

        SimilarCheckResponse res = service.check(USER, WS, request("demand", "导出对账单"));

        assertEquals(3, res.getItems().size(), "最多 3 条，无关的登录白屏被过滤");
        assertEquals("D3", res.getItems().get(0).getId(), "完全一致排第一");
        assertEquals("已通过", res.getItems().get(0).getStatusName());
        assertEquals("D4", res.getItems().get(1).getId(), "包含关系次之");
        assertEquals("D2", res.getItems().get(2).getId());
        assertEquals("未归属项目", res.getItems().get(2).getProjectName(), "项目缺失给可读回退");
        assertEquals("已完成", res.getItems().get(2).getStatusName());
        assertTrue(res.getItems().get(0).getScore() >= res.getItems().get(1).getScore());
        assertTrue(res.getItems().get(2).getSnippet().contains("按月汇总"));
    }

    @Test
    void duplicateTitlesCollapseToOne() {
        when(demands.selectSimilarSources(eq(WS), eq(USER), isNull(), anyInt())).thenReturn(Arrays.asList(
                row("D1", "导出对账单", "pass", null, "项目甲", null),
                row("D2", "导出 对账单！", "plan", null, "项目乙", null)
        ));

        SimilarCheckResponse res = service.check(USER, WS, request("demand", "导出对账单"));

        assertEquals(1, res.getItems().size());
        assertEquals("D1", res.getItems().get(0).getId());
    }

    @Test
    void defectUsesBoardColumnName() {
        when(tasks.selectSimilarDefects(eq(WS), eq(USER), isNull(), anyInt())).thenReturn(Arrays.asList(
                row("W1", "登录页白屏", "testing", "测试中", "项目甲", "企业微信扫码后回跳白屏")
        ));

        SimilarCheckResponse res = service.check(USER, WS, request("defect", "登录页白屏"));

        assertEquals(1, res.getItems().size());
        assertEquals("测试中", res.getItems().get(0).getStatusName());
        assertEquals("testing", res.getItems().get(0).getStatus());
        verify(tasks).selectSimilarDefects(eq(WS), eq(USER), isNull(), anyInt());
        verify(demands, never()).selectSimilarSources(anyString(), anyString(), anyString(), anyInt());
    }

    @Test
    void readOnlyProjectRejectedBeforeQuery() {
        doThrow(new AppException(403, "只读"))
                .when(access).assertView(WS, USER, PROJECT);

        AppException e = assertThrows(AppException.class,
                () -> service.check(USER, WS, request("demand", "导出对账单")));

        assertEquals(403, e.getCode());
        verifyNoInteractions(demands, tasks);
    }

    @Test
    void viewerAndExcludeArePassedToQuery() {
        SimilarCheckRequest req = request("demand", "导出对账单");
        req.setExcludeId("D9");

        service.check(USER, WS, req);

        verify(demands).selectSimilarSources(WS, USER, "D9", 1200);
    }

    @Test
    void descriptionRaisesScoreWhenBothSidesHaveOne() {
        String title = "支付超时";
        String otherTitle = "支付回调超时";
        String desc = "扫码支付一直转圈，最后提示超时";

        double withDesc = SimilarItemService.score(
                com.hourglass.common.SimilarityText.normalize(title),
                com.hourglass.common.SimilarityText.normalize(desc),
                otherTitle, desc);
        double titleOnly = SimilarItemService.score(
                com.hourglass.common.SimilarityText.normalize(title),
                "", otherTitle, desc);

        assertTrue(withDesc > titleOnly, "描述一致时应抬高排序分");
    }

    @Test
    void blankRequestRejected() {
        AppException e = assertThrows(AppException.class, () -> service.check(USER, WS, null));
        assertEquals(400, e.getCode());
    }

    @Test
    void projectIdOptionalForUnscopedCheck() {
        SimilarCheckRequest req = request("defect", "登录页白屏");
        req.setProjectId(null);
        when(tasks.selectSimilarDefects(eq(WS), eq(USER), isNull(), anyInt()))
                .thenReturn(new ArrayList<SimilarSourceRow>());

        service.check(USER, WS, req);

        verify(access, never()).assertView(anyString(), anyString(), anyString());
    }

    @Test
    void rowsWithoutTitleAreIgnored() {
        List<SimilarSourceRow> rows = new ArrayList<SimilarSourceRow>();
        rows.add(row("D1", null, "pass", null, "项目甲", "没有标题"));
        when(demands.selectSimilarSources(eq(WS), eq(USER), isNull(), anyInt())).thenReturn(rows);

        SimilarCheckResponse res = service.check(USER, WS, request("demand", "导出对账单"));

        assertTrue(res.getItems().isEmpty());
    }

    @Test
    void argumentCaptorGuardsLimit() {
        service.check(USER, WS, request("demand", "导出对账单"));
        ArgumentCaptor<Integer> limit = ArgumentCaptor.forClass(Integer.class);
        verify(demands).selectSimilarSources(eq(WS), eq(USER), isNull(), limit.capture());
        assertEquals(1200, limit.getValue().intValue());
    }
}
