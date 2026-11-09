package com.hourglass.service;

import com.hourglass.dto.DemandActionRequest;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
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
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final DemandService service = new DemandService(demands, reqs,
            versions, mock(TaskMapper.class), events, mock(RequirementDocMapper.class),
            mock(ProjectAccessService.class), mock(AttachmentService.class),
            mock(com.hourglass.mapper.MailDeliveryMapper.class), mock(com.hourglass.mapper.TestCaseMapper.class),
            mock(com.hourglass.mapper.CategoryMapper.class), mock(DeliveryScopeLock.class),
            mock(ReleasePermissionService.class));

    @org.junit.jupiter.api.BeforeEach
    void successfulUpdates() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "releases", mock(com.hourglass.mapper.ReleaseMapper.class));
        when(demands.update(org.mockito.ArgumentMatchers.any(Demand.class))).thenReturn(1);
    }

    @Test
    void passNotifiesSubmitter() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);

        service.pass("admin", "W1", "D1", null);

        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」评审通过"), anyString(), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void rejectNotifiesSubmitter() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);
        DemandActionRequest body = new DemandActionRequest();
        body.setNote("not ready");

        service.reject("admin", "W1", "D1", body);

        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」评审拒绝"), eq("not ready"), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void planNotifiesSubmitter() {
        Demand d = demand("pass");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);
        ProjectVersion version = new ProjectVersion();
        version.setId("V1");
        version.setWorkspaceId("W1");
        version.setReqId("R1");
        version.setName("1.0");
        when(versions.selectById("V1")).thenReturn(version);
        when(demands.selectScheduleVersion("W1", "R1", "V1")).thenReturn(version);
        DemandActionRequest body = new DemandActionRequest();
        body.setVersionId("V1");
        body.setRevision(0L);

        service.plan("admin", "W1", "D1", body);

        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」已排期"), eq("目标版本：1.0"), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void reopenNotifiesSubmitter() {
        Demand d = demand("rej");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);

        service.reopen("admin", "W1", "D1", null);

        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」重新打开"), anyString(), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void updateNotifiesSubmitter() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);
        DemandSaveRequest req = new DemandSaveRequest();
        req.setReqId("R1");
        req.setTitle("Demand2");
        req.setRevision(0L);
        com.hourglass.entity.Requirement project = new com.hourglass.entity.Requirement();
        project.setId("R1");
        project.setWorkspaceId("W1");
        when(reqs.selectById("R1")).thenReturn(project);

        service.update("admin", "W1", "D1", req);

        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand2」已被编辑"), eq("需求内容有更新（仍处于待评审）"), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void deleteNotifiesSubmitter() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);

        service.delete("admin", "W1", "D1");

        verify(events).notifyLinked(eq("U-submit"), eq("W1"), eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」已被删除"), anyString(), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void reviewBySubmitterDoesNotNotifySelf() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);

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
