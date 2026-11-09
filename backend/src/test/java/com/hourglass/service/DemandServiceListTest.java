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
            mock(ReleasePermissionService.class));

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
    void canceledStatusIsFilterableAndCountedInAll() {
        when(demands.countGroupByStatus(any(DemandQuery.class))).thenReturn(Arrays.asList(
                countRow("review", 2L), countRow("canceled", 1L)));
        Demand canceled = demand();
        canceled.setStatus("canceled");
        when(demands.selectPage(any(DemandQuery.class))).thenReturn(Collections.singletonList(canceled));
        DemandQuery query = query(null);
        query.setStatus("canceled");
        DemandPage page = service.page("W1", "U1", query);
        assertEquals("canceled", query.getStatus());
        assertEquals(1, page.getTotal());
        assertEquals(3, page.getCounts().get("all"));
        assertEquals("canceled", page.getItems().get(0).getStatus());
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
