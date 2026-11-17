package com.hourglass.service;

import com.hourglass.entity.Demand;
import com.hourglass.mapper.DemandMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DemandCompletionServiceTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final DemandWatchService watches = mock(DemandWatchService.class);
    private final DemandCompletionService service =
            new DemandCompletionService(demands, events, watches);
    private Demand demand;

    @BeforeEach
    void setup() {
        demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId("W1");
        demand.setReqId("R1");
        demand.setTitle("结算对账");
        demand.setStatus("plan");
        demand.setVersionId("V1");
        demand.setCreatedBy("U1");
        when(demands.selectById("D1")).thenReturn(demand);
    }

    private Map<String, Object> evidence(int release, int manual, int taskCount, int taskDone,
                                         int caseCount, int casePassed) {
        Map<String, Object> ev = new HashMap<String, Object>();
        ev.put("releaseDelivered", release);
        ev.put("manualDelivered", manual);
        ev.put("taskCount", taskCount);
        ev.put("taskDone", taskDone);
        ev.put("caseCount", caseCount);
        ev.put("casePassed", casePassed);
        return ev;
    }

    private void stubEvidence(Map<String, Object> ev) {
        when(demands.selectCompletionEvidence("W1", "D1")).thenReturn(ev);
    }

    @Test
    void releaseEvidenceCompletesWithoutTaskAndCaseChecks() {
        stubEvidence(evidence(1, 0, 0, 0, 0, 0));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        assertTrue(service.refreshCompletion("W1", "D1"));

        verify(demands).markDone("W1", "D1");
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("complete"),
                contains("自动完成"), isNull(), contains("\"status\":\"done\""));
        verify(events).notifyLinked(eq("U1"), eq("W1"), anyString(), contains("已完成"),
                anyString(), eq("demand"), eq("D1"), eq("R1"));
        verify(watches).notifyWatchers(eq(demand), isNull(), anyString(), anyString(),
                anyString(), anyCollection());
        verify(demands, never()).reopenFromDone(anyString(), anyString());
    }

    @Test
    void manualDeliveredJudgementCompletesDemand() {
        stubEvidence(evidence(0, 1, 3, 1, 2, 0));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        assertTrue(service.refreshCompletion("W1", "D1"));
        verify(demands).markDone("W1", "D1");
    }

    @Test
    void allTasksDoneAndAllCasesPassedCompletesDemand() {
        stubEvidence(evidence(0, 0, 2, 2, 3, 3));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        assertTrue(service.refreshCompletion("W1", "D1"));
        verify(demands).markDone("W1", "D1");
    }

    @Test
    void noCasesCountsAsPassed() {
        stubEvidence(evidence(0, 0, 1, 1, 0, 0));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        assertTrue(service.refreshCompletion("W1", "D1"));
    }

    @Test
    void pendingTaskKeepsPlan() {
        stubEvidence(evidence(0, 0, 2, 1, 0, 0));

        assertFalse(service.refreshCompletion("W1", "D1"));

        verify(demands, never()).markDone(anyString(), anyString());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString());
        verifyNoInteractions(events);
    }

    @Test
    void failedCaseKeepsPlan() {
        stubEvidence(evidence(0, 0, 2, 2, 3, 2));

        assertFalse(service.refreshCompletion("W1", "D1"));
        verify(demands, never()).markDone(anyString(), anyString());
    }

    @Test
    void noTasksNeverCompletesEvenWithZeroCases() {
        stubEvidence(evidence(0, 0, 0, 0, 0, 0));

        assertFalse(service.refreshCompletion("W1", "D1"));
        verify(demands, never()).markDone(anyString(), anyString());
    }

    @Test
    void backupRefreshPreservesDoneWithoutReleaseOrJudgementEvidence() {
        demand.setStatus("done");
        stubEvidence(evidence(0, 0, 2, 0, 0, 0));

        service.refreshCompletionPreservingDone("W1", Arrays.asList("D1"), false);

        verify(demands, never()).reopenFromDone(anyString(), anyString());
        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString());
        verifyNoInteractions(events);
    }

    @Test
    void backupRefreshStillPromotesPlanWhenImportedEvidenceIsComplete() {
        stubEvidence(evidence(0, 0, 2, 2, 0, 0));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        service.refreshCompletionPreservingDone("W1", Arrays.asList("D1"), false);

        verify(demands).markDone("W1", "D1");
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("complete"), anyString(), isNull(), anyString());
        verifyNoInteractions(events);
    }

    @Test
    void doneDemandReopensToPlanWhenConditionsBreak() {
        demand.setStatus("done");
        stubEvidence(evidence(0, 0, 2, 1, 0, 0));
        when(demands.reopenFromDone("W1", "D1")).thenReturn(1);

        assertTrue(service.refreshCompletion("W1", "D1"));

        verify(demands).reopenFromDone("W1", "D1");
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("auto_reopen"),
                contains("自动退回"), isNull(), contains("\"status\":\"plan\""));
        verify(events).notifyLinked(eq("U1"), eq("W1"), anyString(), contains("已退回已排期"),
                anyString(), eq("demand"), eq("D1"), eq("R1"));
        verify(demands, never()).markDone(anyString(), anyString());
    }

    @Test
    void doneDemandStaysDoneWhileEvidenceHolds() {
        demand.setStatus("done");
        stubEvidence(evidence(1, 0, 0, 0, 0, 0));

        assertFalse(service.refreshCompletion("W1", "D1"));

        verify(demands, never()).reopenFromDone(anyString(), anyString());
        verify(demands, never()).markDone(anyString(), anyString());
        verifyNoInteractions(events);
    }

    @Test
    void otherStatusesHaveNoAutomaticEntry() {
        demand.setStatus("review");
        stubEvidence(evidence(1, 1, 5, 5, 5, 5));

        assertFalse(service.refreshCompletion("W1", "D1"));

        verify(demands, never()).selectCompletionEvidence(anyString(), anyString());
        verify(demands, never()).markDone(anyString(), anyString());
        verify(demands, never()).reopenFromDone(anyString(), anyString());
    }

    @Test
    void lostRaceWritesNothing() {
        stubEvidence(evidence(1, 0, 0, 0, 0, 0));
        when(demands.markDone("W1", "D1")).thenReturn(0);

        assertFalse(service.refreshCompletion("W1", "D1"));

        verify(demands, never()).insertChangeLog(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString());
        verifyNoInteractions(events);
    }

    @Test
    void foreignOrMissingDemandIsIgnored() {
        demand.setWorkspaceId("W2");
        assertFalse(service.refreshCompletion("W1", "D1"));
        when(demands.selectById("D9")).thenReturn(null);
        assertFalse(service.refreshCompletion("W1", "D9"));

        verify(demands, never()).selectCompletionEvidence(anyString(), anyString());
    }

    @Test
    void batchRefreshDeduplicatesAndSkipsNulls() {
        stubEvidence(evidence(0, 0, 1, 1, 0, 0));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        service.refreshCompletion("W1", Arrays.asList("D1", null, "D1"));

        verify(demands, times(1)).markDone("W1", "D1");
        verify(demands, times(1)).selectCompletionEvidence("W1", "D1");
    }

    @Test
    void quietBatchWritesLogsButDoesNotNotify() {
        stubEvidence(evidence(0, 0, 1, 1, 0, 0));
        when(demands.markDone("W1", "D1")).thenReturn(1);

        service.refreshCompletion("W1", Arrays.asList("D1"), false);

        ArgumentCaptor<String> note = ArgumentCaptor.forClass(String.class);
        verify(demands).insertChangeLog(eq("W1"), eq("D1"), eq("complete"), note.capture(),
                isNull(), anyString());
        assertTrue(note.getValue().contains("自动完成"));
        verifyNoInteractions(events);
        verifyNoInteractions(watches);
    }
}
