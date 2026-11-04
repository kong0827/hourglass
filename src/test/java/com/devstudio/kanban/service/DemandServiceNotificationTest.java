package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.DemandActionRequest;
import com.devstudio.kanban.entity.Demand;
import com.devstudio.kanban.entity.ProjectVersion;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DemandServiceNotificationTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final DemandService service = new DemandService(demands, mock(RequirementMapper.class),
            versions, mock(TaskMapper.class), events, mock(RequirementDocMapper.class),
            mock(ProjectAccessService.class), mock(AttachmentService.class),
            mock(com.devstudio.kanban.mapper.MailDeliveryMapper.class));

    @Test
    void passNotifiesSubmitter() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);

        service.pass("admin", "W1", "D1", null);

        verify(events).notify(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」评审通过"), anyString(), eq("D1"), eq("R1"));
    }

    @Test
    void rejectNotifiesSubmitter() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        DemandActionRequest body = new DemandActionRequest();
        body.setNote("not ready");

        service.reject("admin", "W1", "D1", body);

        verify(events).notify(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」评审拒绝"), eq("not ready"), eq("D1"), eq("R1"));
    }

    @Test
    void planNotifiesSubmitter() {
        Demand d = demand("pass");
        when(demands.selectById("D1")).thenReturn(d);
        ProjectVersion version = new ProjectVersion();
        version.setId("V1");
        version.setWorkspaceId("W1");
        version.setReqId("R1");
        version.setName("1.0");
        when(versions.selectById("V1")).thenReturn(version);
        DemandActionRequest body = new DemandActionRequest();
        body.setVersionId("V1");

        service.plan("admin", "W1", "D1", body);

        verify(events).notify(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」已排期"), eq("目标版本：1.0"), eq("D1"), eq("R1"));
    }

    @Test
    void reopenNotifiesSubmitter() {
        Demand d = demand("rej");
        when(demands.selectById("D1")).thenReturn(d);

        service.reopen("admin", "W1", "D1", null);

        verify(events).notify(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」重新打开"), anyString(), eq("D1"), eq("R1"));
    }

    @Test
    void reviewBySubmitterDoesNotNotifySelf() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);

        service.pass("U-submit", "W1", "D1", null);

        verifyNoInteractions(events);
    }

    private Demand demand(String status) {
        Demand d = new Demand();
        d.setId("D1");
        d.setWorkspaceId("W1");
        d.setReqId("R1");
        d.setTitle("Demand");
        d.setCreatedBy("U-submit");
        d.setStatus(status);
        return d;
    }
}
