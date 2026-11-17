package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.Demand;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DemandWatchMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DemandWatchServiceTest {

    private static final String WS = "W1";
    private static final String DEMAND = "D1";
    private static final String PROJECT = "R1";
    private static final String ME = "U1";
    private static final String CREATOR = "U-owner";

    private final DemandWatchMapper watches = mock(DemandWatchMapper.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final DemandWatchService service = new DemandWatchService(watches, demands, users, members,
            access, events);

    private Demand demand;

    @BeforeEach
    void setUp() {
        demand = new Demand();
        demand.setId(DEMAND);
        demand.setWorkspaceId(WS);
        demand.setReqId(PROJECT);
        demand.setCreatedBy(CREATOR);
        demand.setTitle("Demand");
        when(demands.selectById(DEMAND)).thenReturn(demand);
        when(access.canWrite(WS, ME, PROJECT)).thenReturn(true);
    }

    @Test
    void statusReportsWatchingCountAndManageFlag() {
        when(watches.countMine(WS, DEMAND, ME)).thenReturn(1);
        when(watches.selectUserIdsByDemand(WS, DEMAND)).thenReturn(Arrays.asList(ME, "U2"));

        Map<String, Object> res = service.status(ME, WS, DEMAND);

        assertEquals(Boolean.TRUE, res.get("watching"));
        assertEquals(2, res.get("count"));
        assertEquals(Boolean.TRUE, res.get("canManage"));
        assertEquals(CREATOR, res.get("creatorId"));
        verify(access).assertView(WS, ME, PROJECT);
    }

    @Test
    void watchInsertsSelfAndReturnsState() {
        when(watches.countMine(WS, DEMAND, ME)).thenReturn(1);

        Map<String, Object> res = service.watch(ME, WS, DEMAND);

        verify(watches).insertIgnore(WS, DEMAND, ME, ME);
        assertEquals(Boolean.TRUE, res.get("watching"));
    }

    @Test
    void creatorSelfWatchDoesNotEnterRoster() {
        when(watches.countMine(WS, DEMAND, CREATOR)).thenReturn(0);

        Map<String, Object> res = service.watch(CREATOR, WS, DEMAND);

        verify(watches, never()).insertIgnore(anyString(), anyString(), anyString(), anyString());
        assertEquals(Boolean.FALSE, res.get("watching"));
        assertEquals(CREATOR, res.get("creatorId"));
    }

    @Test
    void unwatchDeletesSelf() {
        when(watches.countMine(WS, DEMAND, ME)).thenReturn(0);

        Map<String, Object> res = service.unwatch(ME, WS, DEMAND);

        verify(watches).delete(WS, DEMAND, ME);
        assertEquals(Boolean.FALSE, res.get("watching"));
    }

    @Test
    void addingCreatorIsRejected() {
        AppException ex = assertThrows(AppException.class,
                () -> service.addWatcher(ME, WS, DEMAND, CREATOR));

        assertEquals(400, ex.getCode());
        verify(watches, never()).insertIgnore(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void addingNonMemberIsRejected() {
        when(members.selectMember(WS, "U-x")).thenReturn(null);

        AppException ex = assertThrows(AppException.class,
                () -> service.addWatcher(ME, WS, DEMAND, "U-x"));

        assertEquals(400, ex.getCode());
    }

    @Test
    void addingMemberWithoutProjectVisibilityIsRejected() {
        when(members.selectMember(WS, "U-x")).thenReturn(new WorkspaceMember());
        when(access.canView(WS, "U-x", PROJECT)).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.addWatcher(ME, WS, DEMAND, "U-x"));

        assertEquals(400, ex.getCode());
    }

    @Test
    void addingVisibleMemberRecordsActorAsAdder() {
        when(members.selectMember(WS, "U2")).thenReturn(new WorkspaceMember());
        when(access.canView(WS, "U2", PROJECT)).thenReturn(true);

        service.addWatcher(ME, WS, DEMAND, "U2");

        verify(access).assertWrite(WS, ME, PROJECT);
        verify(watches).insertIgnore(WS, DEMAND, "U2", ME);
    }

    @Test
    void createTimeWatchersSkipCreatorBlanksAndDuplicates() {
        when(members.selectMember(WS, "U2")).thenReturn(new WorkspaceMember());
        when(access.canView(WS, "U2", PROJECT)).thenReturn(true);

        service.addWatchers(demand, ME, Arrays.asList("U2", " U2 ", CREATOR, " ", null));

        verify(watches, times(1)).insertIgnore(WS, DEMAND, "U2", ME);
        verify(watches, never()).insertIgnore(anyString(), anyString(), eq(CREATOR), anyString());
    }

    @Test
    void createTimeWatchersRejectNonMember() {
        when(members.selectMember(WS, "U-x")).thenReturn(null);

        AppException ex = assertThrows(AppException.class,
                () -> service.addWatchers(demand, ME, Collections.singletonList("U-x")));

        assertEquals(400, ex.getCode());
        verify(watches, never()).insertIgnore(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void createTimeWatchersRejectInvisibleMember() {
        when(members.selectMember(WS, "U-x")).thenReturn(new WorkspaceMember());
        when(access.canView(WS, "U-x", PROJECT)).thenReturn(false);

        assertThrows(AppException.class,
                () -> service.addWatchers(demand, ME, Collections.singletonList("U-x")));
        verify(watches, never()).insertIgnore(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void removingOtherRequiresWriteButSelfDoesNot() {
        service.removeWatcher(ME, WS, DEMAND, ME);
        verify(watches).delete(WS, DEMAND, ME);
        verify(access, never()).assertWrite(WS, ME, PROJECT);

        service.removeWatcher(ME, WS, DEMAND, "U2");
        verify(access).assertWrite(WS, ME, PROJECT);
        verify(watches).delete(WS, DEMAND, "U2");
    }

    @Test
    void notifyWatchersSkipsActorAndAlreadyNotifiedUsers() {
        when(watches.selectUserIdsByDemand(WS, DEMAND)).thenReturn(Arrays.asList(ME, CREATOR, "U-watch"));

        service.notifyWatchers(demand, ME, UserNotificationPreferenceService.DEMAND_WATCH,
                "需求更新", "detail", Collections.singletonList(CREATOR));

        verify(events, never()).notifyLinked(eq(ME), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
        verify(events, never()).notifyLinked(eq(CREATOR), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString());
        verify(events).notifyLinked(eq("U-watch"), eq(WS), eq(UserNotificationPreferenceService.DEMAND_WATCH),
                eq("需求更新"), eq("detail"), eq("demand"), eq(DEMAND), eq(PROJECT));
    }

    @Test
    void deletedDemandNotificationCarriesNoDeepLink() {
        service.notifyWatchers(Collections.singletonList("U2"), demand, ME,
                UserNotificationPreferenceService.DEMAND_WATCH, "需求已删除", "detail", null, false);

        verify(events).notifyLinked(eq("U2"), eq(WS), eq(UserNotificationPreferenceService.DEMAND_WATCH),
                eq("需求已删除"), eq("detail"), isNull(), isNull(), eq(PROJECT));
    }

    @Test
    void watcherReadFailureDoesNotBreakBusinessFlow() {
        when(watches.selectUserIdsByDemand(WS, DEMAND)).thenThrow(new RuntimeException("table missing"));

        assertTrue(service.watcherIds(WS, DEMAND).isEmpty());
        service.notifyWatchers(demand, ME, UserNotificationPreferenceService.DEMAND_WATCH,
                "需求更新", "detail", null);
        verify(events, never()).notifyLinked(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString());
    }
}
