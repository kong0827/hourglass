package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 需求评审人（RP-03）：只在创建 / 待评审整单编辑时生效；
 * 必须是项目可写成员，换人时定向通知，非评审态编辑不改评审人。
 */
class DemandReviewerAssignmentTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final NumberSeqService numberSeq = mock(NumberSeqService.class);
    private final CategoryMapper categoryMapper = mock(CategoryMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final DemandService service = new DemandService(demands, reqs,
            mock(ProjectVersionMapper.class), mock(TaskMapper.class), events,
            mock(RequirementDocMapper.class), projectAccess, mock(AttachmentService.class),
            mock(com.hourglass.mapper.MailDeliveryMapper.class), mock(com.hourglass.mapper.TestCaseMapper.class),
            categoryMapper, mock(DeliveryScopeLock.class), mock(ReleasePermissionService.class),
            mock(DeletionTraceService.class), numberSeq, mock(DemandWatchService.class));

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "releases", mock(com.hourglass.mapper.ReleaseMapper.class));
        ReflectionTestUtils.setField(service, "judgementMapper",
                mock(com.hourglass.mapper.DemandDeliveryJudgementMapper.class));
        ReflectionTestUtils.setField(service, "caseTaskMapper", mock(com.hourglass.mapper.TestCaseTaskMapper.class));
        ReflectionTestUtils.setField(service, "demandCommentMapper", mock(com.hourglass.mapper.DemandCommentMapper.class));
        ReflectionTestUtils.setField(service, "userMapper", userMapper);
        org.mockito.Mockito.lenient()
                .when(demands.selectDetail(any(), anyString()))
                .thenAnswer(inv -> demands.selectById(inv.getArgument(1)));
        Requirement project = new Requirement();
        project.setId("R1");
        project.setWorkspaceId("W1");
        org.mockito.Mockito.lenient().when(reqs.selectById("R1")).thenReturn(project);
    }

    @Test
    void createAssignsWritableReviewerAndNotifies() {
        when(projectAccess.roleOf("W1", "U-rev")).thenReturn("member");
        when(projectAccess.canWrite("W1", "U-rev", "R1")).thenReturn(true);
        java.util.concurrent.atomic.AtomicReference<Demand> inserted =
                new java.util.concurrent.atomic.AtomicReference<Demand>();
        when(demands.insert(any(Demand.class))).thenAnswer(inv -> {
            inserted.set(inv.getArgument(0));
            return 1;
        });
        when(demands.selectById(anyString())).thenAnswer(inv -> inserted.get());
        when(numberSeq.nextDemand("W1", "R1")).thenReturn(8);

        Demand saved = service.create("U-owner", "W1", request("U-rev"));

        assertEquals("U-rev", saved.getReviewerUserId());
        verify(events).notifyLinked(eq("U-rev"), eq("W1"),
                eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」指派你评审"), anyString(), eq("demand"), eq(saved.getId()), eq("R1"));
    }

    @Test
    void createRejectsViewerAsReviewer() {
        when(projectAccess.roleOf("W1", "U-viewer")).thenReturn("viewer");
        when(projectAccess.canWrite("W1", "U-viewer", "R1")).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.create("U-owner", "W1", request("U-viewer")));

        assertEquals(400, ex.getCode());
        verify(demands, never()).insert(any(Demand.class));
    }

    @Test
    void createRejectsReviewerWithoutProjectWrite() {
        when(projectAccess.roleOf("W1", "U-reader")).thenReturn("member");
        when(projectAccess.canWrite("W1", "U-reader", "R1")).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.create("U-owner", "W1", request("U-reader")));

        assertEquals(400, ex.getCode());
        verify(demands, never()).insert(any(Demand.class));
    }

    @Test
    void updateReassignsReviewerOnlyInReviewStatus() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);
        when(demands.update(any(Demand.class))).thenReturn(1);
        when(projectAccess.roleOf("W1", "U-rev")).thenReturn("member");
        when(projectAccess.canWrite("W1", "U-rev", "R1")).thenReturn(true);

        Demand saved = service.update("U-owner", "W1", "D1", request("U-rev"));

        assertEquals("U-rev", saved.getReviewerUserId());
        verify(events).notifyLinked(eq("U-rev"), eq("W1"),
                eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」指派你评审"), anyString(), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void updateIgnoresReviewerAfterReviewStage() {
        Demand d = demand("pass");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(d);
        when(demands.update(any(Demand.class))).thenReturn(1);

        Demand saved = service.update("U-owner", "W1", "D1", request("U-rev"));

        assertNull(saved.getReviewerUserId());
        verify(events, never()).notifyLinked(eq("U-rev"), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void reviewerNameIsFilledForListAndDetail() {
        Demand d = demand("review");
        d.setReviewerUserId("U-rev");
        when(demands.selectDetail(any(), eq("D1"))).thenReturn(d);
        AppUser user = new AppUser();
        user.setId("U-rev");
        user.setDisplayName("评审同学");
        when(userMapper.selectByIds(any())).thenReturn(Arrays.asList(user));

        Demand loaded = service.get("W1", "D1");

        assertEquals("评审同学", loaded.getReviewerName());
    }

    @Test
    void claimReviewAssignsSelfAndNotifiesCreator() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.claimReviewer("W1", "D1", "U-me")).thenAnswer(inv -> {
            d.setReviewerUserId("U-me");
            d.setRevision(1L);
            return 1;
        });

        Demand claimed = service.claimReview("U-me", "W1", "D1");

        assertEquals("U-me", claimed.getReviewerUserId());
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("claim"), eq("认领评审"),
                eq("U-me"), anyString());
        verify(events).notifyLinked(eq("U-submit"), eq("W1"),
                eq(UserNotificationPreferenceService.DEMAND_STATUS),
                eq("需求「Demand」已有评审人"), anyString(), eq("demand"), eq("D1"), eq("R1"));
    }

    @Test
    void claimReviewRejectsViewer() {
        when(demands.selectById("D1")).thenReturn(demand("review"));
        org.mockito.Mockito.doThrow(new AppException(403, "你在此空间是查看者，只能查看不能修改"))
                .when(projectAccess).assertWrite("W1", "U-viewer", "R1");

        AppException ex = assertThrows(AppException.class,
                () -> service.claimReview("U-viewer", "W1", "D1"));

        assertEquals(403, ex.getCode());
        verify(demands, never()).claimReviewer(anyString(), anyString(), anyString());
    }

    @Test
    void claimReviewRejectsSelfSubmittedDemand() {
        Demand d = demand("review");
        d.setCreatedBy("U-me");
        when(demands.selectById("D1")).thenReturn(d);

        AppException ex = assertThrows(AppException.class,
                () -> service.claimReview("U-me", "W1", "D1"));

        assertEquals(400, ex.getCode());
        verify(demands, never()).claimReviewer(anyString(), anyString(), anyString());
    }

    @Test
    void claimReviewRejectsDemandAssignedToSomeoneElse() {
        Demand d = demand("review");
        d.setReviewerUserId("U-other");
        when(demands.selectById("D1")).thenReturn(d);

        AppException ex = assertThrows(AppException.class,
                () -> service.claimReview("U-me", "W1", "D1"));

        assertEquals(409, ex.getCode());
        verify(demands, never()).claimReviewer(anyString(), anyString(), anyString());
    }

    @Test
    void claimReviewIsIdempotentWhenAlreadyMine() {
        Demand d = demand("review");
        d.setReviewerUserId("U-me");
        when(demands.selectById("D1")).thenReturn(d);

        Demand claimed = service.claimReview("U-me", "W1", "D1");

        assertEquals("U-me", claimed.getReviewerUserId());
        verify(demands, never()).claimReviewer(anyString(), anyString(), anyString());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
    }

    @Test
    void claimReviewRejectsNonReviewStatus() {
        when(demands.selectById("D1")).thenReturn(demand("pass"));

        AppException ex = assertThrows(AppException.class,
                () -> service.claimReview("U-me", "W1", "D1"));

        assertEquals(400, ex.getCode());
        verify(demands, never()).claimReviewer(anyString(), anyString(), anyString());
    }

    @Test
    void claimReviewConflictsWhenAnotherUserWinsTheRace() {
        Demand d = demand("review");
        when(demands.selectById("D1")).thenReturn(d);
        when(demands.claimReviewer("W1", "D1", "U-me")).thenReturn(0);

        AppException ex = assertThrows(AppException.class,
                () -> service.claimReview("U-me", "W1", "D1"));

        assertEquals(409, ex.getCode());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
    }

    private DemandSaveRequest request(String reviewerUserId) {
        DemandSaveRequest req = new DemandSaveRequest();
        req.setReqId("R1");
        req.setTitle("Demand");
        req.setRevision(0L);
        req.setReviewerUserId(reviewerUserId);
        return req;
    }

    private Demand demand(String status) {
        Demand d = new Demand();
        d.setId("D1");
        d.setWorkspaceId("W1");
        d.setReqId("R1");
        d.setTitle("Demand");
        d.setCreatedBy("U-submit");
        d.setStatus(status);
        d.setRevision(0L);
        return d;
    }
}
