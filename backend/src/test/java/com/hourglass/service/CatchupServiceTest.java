package com.hourglass.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.dto.CatchupDecisionRequest;
import com.hourglass.dto.CatchupDraft;
import com.hourglass.dto.CatchupPlanRow;
import com.hourglass.dto.CatchupView;
import com.hourglass.dto.CatchupTaskRow;
import com.hourglass.dto.CatchupTimeRequest;
import com.hourglass.dto.CatchupTimeSum;
import com.hourglass.entity.CatchupCarry;
import com.hourglass.entity.CatchupDecision;
import com.hourglass.entity.CatchupSession;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CatchupMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 补记批次一：写入权限、跨周承接、截断可见与交付物不占风险数。 */
class CatchupServiceTest {

    private static final String WS = "W1";
    private static final String UID = "U1";
    private static final LocalDate WEEK = LocalDate.parse("2026-11-16");

    private final CatchupMapper mapper = mock(CatchupMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final UserMapper users = mock(UserMapper.class);
    private final BoardColumnMapper columns = mock(BoardColumnMapper.class);
    private final CatchupService service = new CatchupService(mapper, access, users, columns, new ObjectMapper());

    @Test
    void viewerCannotWriteCatchup() {
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        when(access.canWrite(WS, UID, null)).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () -> service.skip(WS, UID, WEEK.toString()));

        assertEquals(403, ex.getCode());
        assertTrue(ex.getMessage().contains("查看者"));
    }

    @Test
    void viewerWriteIsRejectedBeforeSessionIsCreated() {
        when(access.canWrite(WS, UID, null)).thenReturn(false);

        assertEquals(403, assertThrows(AppException.class,
                () -> service.submit(WS, UID, WEEK.toString())).getCode());
        assertEquals(403, assertThrows(AppException.class,
                () -> service.start(WS, UID, WEEK.toString())).getCode());
        assertEquals(403, assertThrows(AppException.class,
                () -> service.decide(WS, UID, decision("task:T1", "work", "accept"))).getCode());

        verify(mapper, never()).insertSession(any(CatchupSession.class));
    }

    @Test
    void readOnlyProjectRejectsDecisionOnItsTask() {
        when(access.canWrite(WS, UID, null)).thenReturn(true);
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any()))
                .thenReturn(Collections.singletonList(task("T1", "修复登录")));
        when(mapper.selectTaskReqId(WS, "T1")).thenReturn("P1");
        doThrow(new AppException(403, "你对该项目只有查看权限"))
                .when(access).assertWrite(WS, UID, "P1");

        CatchupDecisionRequest req = decision("task:T1", "work", "accept");

        AppException ex = assertThrows(AppException.class, () -> service.decide(WS, UID, req));
        assertEquals(403, ex.getCode());
    }

    @Test
    void projectWritableDecisionPasses() {
        when(access.canWrite(WS, UID, null)).thenReturn(true);
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any()))
                .thenReturn(Collections.singletonList(task("T1", "修复登录")));
        when(mapper.selectTaskReqId(WS, "T1")).thenReturn("P1");

        assertDoesNotThrow(() -> service.decide(WS, UID, decision("task:T1", "work", "accept")));
        verify(mapper).upsertDecision(any(CatchupDecision.class));
    }

    @Test
    void submitCarriesPendingAndSkippedIntoNextWeek() {
        stubWritableDraftSession();
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any()))
                .thenReturn(Arrays.asList(task("T1", "待确认"), task("T2", "用户跳过"), task("T3", "已确认")));
        when(mapper.selectDecisions("CP1")).thenReturn(Arrays.asList(
                decisionRow("task:T2", "work", "skip"),
                decisionRow("task:T3", "work", "accept")));

        service.submit(WS, UID, WEEK.toString());

        ArgumentCaptor<CatchupCarry> captor = ArgumentCaptor.forClass(CatchupCarry.class);
        verify(mapper, times(2)).insertCarry(captor.capture());
        List<CatchupCarry> carries = captor.getAllValues();
        assertEquals("T1", carries.get(0).getTaskId());
        assertEquals("pending", carries.get(0).getReason());
        assertEquals("T2", carries.get(1).getTaskId());
        assertEquals("skipped", carries.get(1).getReason());
        assertEquals(WEEK.plusDays(7), carries.get(0).getToWeekStart());
        verify(mapper, times(1)).insertTaskLog(any());
    }

    @Test
    void carriedDraftsComeFirstAndMarkEvidence() {
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any()))
                .thenReturn(Collections.singletonList(task("T1", "本周还在做")));
        CatchupCarry carriedThisWeek = carry("T1", "skipped");
        CatchupCarry carriedOnly = carry("T9", "pending");
        when(mapper.selectCarryForWeek(WS, UID, WEEK, null)).thenReturn(Arrays.asList(carriedThisWeek, carriedOnly));

        CatchupView view = service.view(WS, UID, WEEK.toString());

        assertEquals(2, view.getDrafts().size());
        assertTrue(Boolean.TRUE.equals(view.getDrafts().get(0).getCarried()));
        assertTrue(Boolean.TRUE.equals(view.getDrafts().get(1).getCarried()));
        assertEquals("task:T9", view.getDrafts().get(1).getKey());
        assertTrue(view.getDrafts().get(1).getEvidence().stream()
                .anyMatch(e -> "carry".equals(e.getKind())));
        assertEquals(2, view.getCounts().get("carried"));
    }

    @Test
    void submitPrunesCarryRowsOlderThanCurrentWeek() {
        stubWritableDraftSession();

        service.submit(WS, UID, WEEK.toString());

        verify(mapper).deleteCarryBefore(WS, UID, LocalDate.now().with(DayOfWeek.MONDAY));
    }

    @Test
    void carriedTaskMergedWithThisWeekTimeLogsThisWeekHours() {
        stubWritableDraftSession();
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any()))
                .thenReturn(Collections.singletonList(task("T1", "修复登录")));
        CatchupTimeSum sum = new CatchupTimeSum();
        sum.setTaskId("T1");
        sum.setMinutes(90);
        when(mapper.selectMyTimeByTask(eq(WS), eq(UID), any(), any()))
                .thenReturn(Collections.singletonList(sum));
        when(mapper.selectCarryForWeek(WS, UID, WEEK, null))
                .thenReturn(Collections.singletonList(carry("T1", "pending")));
        when(mapper.selectDecisions("CP1"))
                .thenReturn(Collections.singletonList(decisionRow("task:T1", "work", "accept")));

        service.submit(WS, UID, WEEK.toString());

        ArgumentCaptor<TaskLog> captor = ArgumentCaptor.forClass(TaskLog.class);
        verify(mapper).insertTaskLog(captor.capture());
        String detail = captor.getValue().getDetail();
        assertTrue(detail.contains("补确认上周未处理"));
        assertTrue(detail.contains("本周 1.5h"), detail);
    }

    @Test
    void carriedOnlyTaskLogsCarriedMinutesAsLastWeek() {
        stubWritableDraftSession();
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any()))
                .thenReturn(Collections.<CatchupTaskRow>emptyList());
        CatchupCarry carried = carry("T9", "pending");
        carried.setMinutes(120);
        when(mapper.selectCarryForWeek(WS, UID, WEEK, null))
                .thenReturn(Collections.singletonList(carried));
        when(mapper.selectDecisions("CP1"))
                .thenReturn(Collections.singletonList(decisionRow("task:T9", "work", "accept")));

        service.submit(WS, UID, WEEK.toString());

        ArgumentCaptor<TaskLog> captor = ArgumentCaptor.forClass(TaskLog.class);
        verify(mapper).insertTaskLog(captor.capture());
        String detail = captor.getValue().getDetail();
        assertTrue(detail.contains("补确认上周未处理"));
        assertTrue(detail.contains("上周 2h"), detail);
    }

    @Test
    void draftsBeyondCapAreCountedAsHidden() {
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        List<CatchupTaskRow> rows = new ArrayList<CatchupTaskRow>();
        for (int i = 0; i < 13; i++) {
            rows.add(task("T" + i, "工作项" + i));
        }
        when(mapper.selectMyTasksForWeek(eq(WS), eq(UID), any(), any(), any(), any())).thenReturn(rows);

        CatchupView view = service.view(WS, UID, WEEK.toString());

        assertEquals(12, view.getDrafts().size());
        assertEquals(1, view.getCounts().get("hidden"));
    }

    @Test
    void planDeliverableDoesNotCountAsOpenRisk() {
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        CatchupPlanRow plan = new CatchupPlanRow();
        plan.setPlanId("PL1");
        plan.setName("回归计划");
        plan.setUpdatedAt(WEEK.plusDays(2).atTime(18, 0));
        plan.setExecutedCount(12);
        when(mapper.selectMyDonePlans(eq(WS), eq(UID), any(), any(), any()))
                .thenReturn(Collections.singletonList(plan));

        CatchupView view = service.view(WS, UID, WEEK.toString());

        assertEquals(1, view.getRisks().size());
        assertEquals(0, view.getCounts().get("riskTotal"));
        assertEquals(0, view.getCounts().get("riskHandled"));
    }

    @Test
    void saveTimeRejectsDayTotalOver24Hours() {
        stubWritableDraftSession();
        when(access.canView(WS, UID, "P1")).thenReturn(true);
        CatchupTimeRequest req = new CatchupTimeRequest();
        req.setWeek(WEEK.toString());
        req.setCells(Arrays.asList(timeCell("req:P1", "P1", WEEK, 700), timeCell("unassigned", null, WEEK, 800)));

        assertEquals(400, assertThrows(AppException.class, () -> service.saveTime(WS, UID, req)).getCode());
        verify(mapper, never()).deleteAllocs(anyString());
    }

    @Test
    void saveTimeRejectsProjectOutsideVisibility() {
        stubWritableDraftSession();
        when(access.canView(WS, UID, "P1")).thenReturn(false);
        CatchupTimeRequest req = new CatchupTimeRequest();
        req.setWeek(WEEK.toString());
        req.setCells(Collections.singletonList(timeCell("req:P1", "P1", WEEK, 60)));

        assertEquals(400, assertThrows(AppException.class, () -> service.saveTime(WS, UID, req)).getCode());
        verify(mapper, never()).deleteAllocs(anyString());
    }

    @Test
    void linkActionIsNoLongerAccepted() {
        when(access.canWrite(WS, UID, null)).thenReturn(true);
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        CatchupPlanRow plan = new CatchupPlanRow();
        plan.setPlanId("PL1");
        plan.setName("回归计划");
        plan.setUpdatedAt(WEEK.plusDays(2).atTime(18, 0));
        when(mapper.selectMyDonePlans(eq(WS), eq(UID), any(), any(), any()))
                .thenReturn(Collections.singletonList(plan));

        AppException ex = assertThrows(AppException.class,
                () -> service.decide(WS, UID, decision("risk:plan:PL1", "risk", "link")));

        assertEquals(400, ex.getCode());
    }

    /* ---------------- 造数 ---------------- */

    private void stubWritableDraftSession() {
        when(access.canWrite(WS, UID, null)).thenReturn(true);
        when(mapper.selectSession(WS, UID, WEEK)).thenReturn(session("draft"));
        when(mapper.selectDecisions("CP1")).thenReturn(Collections.emptyList());
    }

    private static CatchupTimeRequest.Cell timeCell(String rowKey, String reqId, LocalDate day, int minutes) {
        CatchupTimeRequest.Cell c = new CatchupTimeRequest.Cell();
        c.setRowKey(rowKey);
        c.setReqId(reqId);
        c.setDay(day.toString());
        c.setMinutes(minutes);
        return c;
    }

    private static CatchupSession session(String status) {
        CatchupSession s = new CatchupSession();
        s.setId("CP1");
        s.setWorkspaceId(WS);
        s.setUserId(UID);
        s.setWeekStart(WEEK);
        s.setStatus(status);
        s.setNoOtherRisk(false);
        return s;
    }

    private static CatchupTaskRow task(String id, String title) {
        CatchupTaskRow t = new CatchupTaskRow();
        t.setTaskId(id);
        t.setTitle(title);
        t.setItemType("task");
        t.setItemNo(1);
        t.setBoardColumn("doing");
        t.setReqId("P1");
        t.setReqName("演示项目");
        t.setUpdatedAt(WEEK.plusDays(1).atTime(10, 0));
        t.setCreatedAt(WEEK.minusDays(30).atTime(10, 0));
        t.setBlocked(false);
        t.setOwnerUserId(UID);
        return t;
    }

    private static CatchupCarry carry(String taskId, String reason) {
        CatchupCarry c = new CatchupCarry();
        c.setFromSessionId("CP0");
        c.setToWeekStart(WEEK);
        c.setTaskId(taskId);
        c.setTitle("上周未处理 " + taskId);
        c.setStatusLabel("进行中");
        c.setMinutes(0);
        c.setReason(reason);
        c.setCreatedAt(WEEK.minusDays(3).atTime(18, 0));
        return c;
    }

    private static CatchupDecision decisionRow(String key, String kind, String action) {
        CatchupDecision d = new CatchupDecision();
        d.setSessionId("CP1");
        d.setDraftKey(key);
        d.setKind(kind);
        d.setAction(action);
        return d;
    }

    private static CatchupDecisionRequest decision(String key, String kind, String action) {
        CatchupDecisionRequest req = new CatchupDecisionRequest();
        req.setWeek(WEEK.toString());
        req.setDraftKey(key);
        req.setKind(kind);
        req.setAction(action);
        return req;
    }
}
