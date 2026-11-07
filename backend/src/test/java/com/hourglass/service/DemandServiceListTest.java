package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
            mock(com.hourglass.mapper.MailDeliveryMapper.class));

    @Test
    void listsWholeWorkspaceWithoutProjectAndComputesWsjf() {
        when(demands.selectByWorkspace("W1")).thenReturn(Collections.singletonList(demand()));

        List<Demand> result = service.list("W1", null);

        assertEquals(1, result.size());
        assertEquals(1.5d, result.get(0).getWsjfScore());
        verifyNoInteractions(reqs);
        verify(demands, never()).selectByReq("W1", null);
    }

    @Test
    void blankProjectFallsBackToWholeWorkspace() {
        when(demands.selectByWorkspace("W1")).thenReturn(Collections.<Demand>emptyList());

        assertEquals(Collections.emptyList(), service.list("W1", "  "));

        verifyNoInteractions(reqs);
    }

    @Test
    void keepsProjectScopedListing() {
        Requirement req = new Requirement();
        req.setId("R1");
        req.setWorkspaceId("W1");
        when(reqs.selectById("R1")).thenReturn(req);
        when(demands.selectByReq("W1", "R1")).thenReturn(Arrays.asList(demand(), demand()));

        List<Demand> result = service.list("W1", "R1");

        assertEquals(2, result.size());
        verify(demands, never()).selectByWorkspace("W1");
    }

    @Test
    void rejectsProjectFromAnotherWorkspace() {
        Requirement req = new Requirement();
        req.setId("R1");
        req.setWorkspaceId("W2");
        when(reqs.selectById("R1")).thenReturn(req);

        AppException error = assertThrows(AppException.class, () -> service.list("W1", "R1"));

        assertEquals(404, error.getCode());
        verify(demands, never()).selectByReq("W1", "R1");
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
