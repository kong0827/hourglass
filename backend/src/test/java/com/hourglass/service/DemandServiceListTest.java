package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DemandServiceListTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final DemandService service = new DemandService(demands, reqs,
            mock(ProjectVersionMapper.class), mock(TaskMapper.class),
            mock(NotificationEventService.class), mock(RequirementDocMapper.class),
            mock(ProjectAccessService.class), mock(AttachmentService.class),
            mock(com.hourglass.mapper.MailDeliveryMapper.class), mock(com.hourglass.mapper.TestCaseMapper.class),
            mock(com.hourglass.mapper.CategoryMapper.class), mock(DeliveryScopeLock.class),
            mock(ReleasePermissionService.class), mock(DeletionTraceService.class), mock(NumberSeqService.class));

    @Test
    void pagesWholeWorkspaceAndComputesWsjf() {
        when(demands.countGroupByStatus(any(DemandQuery.class)))
                .thenReturn(Collections.singletonList(countRow("review", 1L)));
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Collections.singletonList(demand()));

        DemandPage result = service.page("W1", "U1", query(null));

        assertEquals(1, result.getItems().size());
        assertEquals(1.5d, result.getItems().get(0).getWsjfScore());
        assertEquals(1, result.getTotal());
        verifyNoInteractions(reqs);
        verify(demands, never()).selectByWorkspace("W1");
    }

    @Test
    void legacyCanceledStatusNormalizesToClosed() {
        when(demands.countGroupByStatus(any(DemandQuery.class))).thenReturn(Arrays.asList(
                countRow("review", 2L), countRow("closed", 1L)));
        Demand closed = demand();
        closed.setStatus("closed");
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Collections.singletonList(closed));
        DemandQuery query = query(null);
        query.setStatus("canceled");
        DemandPage page = service.page("W1", "U1", query);
        assertEquals("closed", query.getStatus());
        assertEquals(1, page.getTotal());
        assertEquals(3, page.getCounts().get("all"));
        assertEquals("closed", page.getItems().get(0).getStatus());
    }

    @Test
    void clampsPageSizeToOneHundred() {
        DemandQuery query = query(null);
        query.setLimit(500);

        DemandPage result = service.page("W1", "U1", query);

        assertEquals(100, result.getLimit());
        verify(demands, never()).selectPage(any(DemandQuery.class));
    }

    @Test
    void normalizesOffsetAndMinimumPageSize() {
        DemandQuery query = query(null);
        query.setOffset(-10);
        query.setLimit(0);

        DemandPage result = service.page("W1", "U1", query);

        assertEquals(0, result.getOffset());
        assertEquals(1, result.getLimit());
    }

    @Test
    void keepsProjectScopedPaging() {
        Requirement req = new Requirement();
        req.setId("R1");
        req.setWorkspaceId("W1");
        when(reqs.selectById("R1")).thenReturn(req);
        when(demands.countGroupByStatus(any(DemandQuery.class)))
                .thenReturn(Collections.singletonList(countRow("review", 2L)));
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Arrays.asList(demand(), demand()));

        DemandPage result = service.page("W1", "U1", query("R1"));

        assertEquals(2, result.getItems().size());
        ArgumentCaptor<DemandQuery> captor = ArgumentCaptor.forClass(DemandQuery.class);
        verify(demands).selectPage(captor.capture());
        assertEquals("R1", captor.getValue().getReqId());
        verify(demands, never()).selectByReq("W1", "R1");
    }

    @Test
    void rejectsProjectFromAnotherWorkspace() {
        Requirement req = new Requirement();
        req.setId("R1");
        req.setWorkspaceId("W2");
        when(reqs.selectById("R1")).thenReturn(req);

        AppException error = assertThrows(AppException.class, () -> service.page("W1", "U1", query("R1")));

        assertEquals(404, error.getCode());
        verify(demands, never()).selectPage(any(DemandQuery.class));
    }

    @Test
    void boardFacetsIgnoreSelectedFiltersButKeepKeywordAndProject() {
        Requirement req = new Requirement();
        req.setId("R1");
        req.setWorkspaceId("W1");
        when(reqs.selectById("R1")).thenReturn(req);
        when(demands.countGroupByStatus(any(DemandQuery.class)))
                .thenReturn(Collections.singletonList(countRow("review", 1L)));
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Collections.singletonList(demand()));
        when(demands.countGroupByFacets(any(DemandQuery.class))).thenReturn(Arrays.asList(
                facetRow("P0", "新功能", "C1", 2L),
                facetRow("P0", "缺陷", null, 1L),
                facetRow("P2", "新功能", "C1", 3L)));
        DemandQuery query = query("R1");
        query.setQ("支付");
        query.setPris(new java.util.ArrayList<String>(Collections.singletonList("P0")));
        query.setKinds(new java.util.ArrayList<String>(Collections.singletonList("缺陷")));

        com.hourglass.dto.DemandBoardResponse resp = service.board("W1", "U1", query);

        Map<String, Map<String, Integer>> f = resp.getFacets();
        assertEquals(3, f.get("pris").get("P0"));
        assertEquals(3, f.get("pris").get("P2"));
        assertEquals(5, f.get("kinds").get("新功能"));
        assertEquals(1, f.get("kinds").get("缺陷"));
        assertEquals(5, f.get("cats").get("C1"));
        assertEquals(1, f.get("cats").get(""));
        ArgumentCaptor<DemandQuery> captor = ArgumentCaptor.forClass(DemandQuery.class);
        verify(demands).countGroupByFacets(captor.capture());
        DemandQuery scope = captor.getValue();
        assertEquals("R1", scope.getReqId());
        assertEquals("支付", scope.getQ());
        assertNull(scope.getStatus());
        assertEquals(0, scope.getPris().size());
        assertEquals(0, scope.getKinds().size());
        assertEquals(1, query.getPris().size(), "看板列查询仍按所选优先级过滤");
    }

    @Test
    void workpageSeparatesGlobalTabsFromFilteredMetricsAndSortsVersionsNaturally() {
        when(demands.countGroupByStatus(any(DemandQuery.class))).thenReturn(Arrays.asList(
                countRow("review", 2L), countRow("plan", 5L), countRow("closed", 1L)));
        when(demands.countGroupByDeliveryStage(any(DemandQuery.class))).thenReturn(Arrays.asList(
                stageRow("waiting", 2L), stageRow("active", 3L)));
        when(demands.countPage(any(DemandQuery.class))).thenReturn(3);
        Demand item = demand();
        item.setStatus("plan");
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Collections.singletonList(item));
        Map<String, Object> metrics = new HashMap<String, Object>();
        metrics.put("demandCount", 3L);
        when(demands.workpageMetrics(any(DemandQuery.class))).thenReturn(metrics);
        when(demands.selectWorkpageVersions(any(DemandQuery.class))).thenReturn(new java.util.ArrayList<Map<String, Object>>(Arrays.asList(
                versionRow("V2", "V1.2"), versionRow("__none", "未指定版本"), versionRow("V10", "V1.10"))));
        DemandQuery query = query(null);
        query.setStatus("plan");
        query.setDeliveryStage("active");
        query.setVersionId("V2");
        query.setFocus("risk");

        com.hourglass.dto.DemandWorkpageResponse result = service.workpage("W1", "U1", query);

        assertEquals(8, result.getStatusCounts().get("all"));
        assertEquals(5, result.getStatusCounts().get("plan"));
        assertEquals(5, result.getStageCounts().get("all"));
        assertEquals(3, result.getStageCounts().get("active"));
        assertEquals(3, result.getPage().getTotal());
        assertEquals(3L, result.getMetrics().get("demandCount"));
        assertEquals("V10", result.getVersions().get(0).get("versionId"));
        assertEquals("V2", result.getVersions().get(1).get("versionId"));
        assertEquals("__none", result.getVersions().get(2).get("versionId"));
        ArgumentCaptor<DemandQuery> captor = ArgumentCaptor.forClass(DemandQuery.class);
        verify(demands).selectWorkpageVersions(captor.capture());
        assertEquals("plan", captor.getValue().getStatus());
        assertNull(captor.getValue().getDeliveryStage());
        assertNull(captor.getValue().getVersionId());
        assertEquals("risk", captor.getValue().getFocus());
    }

    private Map<String, Object> stageRow(String stage, long count) {
        Map<String, Object> row = new HashMap<String, Object>();
        row.put("stage", stage);
        row.put("cnt", count);
        return row;
    }

    private Map<String, Object> versionRow(String id, String name) {
        Map<String, Object> row = new HashMap<String, Object>();
        row.put("versionId", id);
        row.put("versionName", name);
        row.put("demandCount", 1L);
        return row;
    }

    private Map<String, Object> facetRow(String pri, String kind, String cat, long count) {
        Map<String, Object> row = new HashMap<String, Object>();
        row.put("pri", pri);
        row.put("kind", kind);
        if (cat != null) row.put("cat", cat);
        row.put("cnt", count);
        return row;
    }

    private DemandQuery query(String reqId) {
        DemandQuery query = new DemandQuery();
        query.setReqId(reqId);
        query.setLimit(100);
        return query;
    }

    private Map<String, Object> countRow(String status, long count) {
        Map<String, Object> row = new HashMap<String, Object>();
        row.put("status", status);
        row.put("cnt", count);
        return row;
    }

    private Demand demand() {
        Demand d = new Demand();
        d.setId("D1");
        d.setWorkspaceId("W1");
        d.setReqId("R1");
        d.setStatus("review");
        d.setWsjfBusiness(5);
        d.setWsjfUrgency(3);
        d.setWsjfRisk(4);
        d.setWsjfEffort(8);
        assertNull(d.getWsjfScore());
        return d;
    }
}
