package com.hourglass.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BranchLifecycleRulesTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 15, 10, 0);

    @Test
    void unmergedDisappearedGoesPending() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                BranchLifecycleRules.REMOTE_DELETED, false, NOW.minusDays(3), null, null, "open");
        assertEquals(BranchLifecycleRules.OUTCOME_PENDING, r.outcome);
        assertEquals(BranchLifecycleRules.PENDING_DISAPPEARED, r.pendingReason);
    }

    @Test
    void mergedDisappearedIsDone() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                BranchLifecycleRules.REMOTE_DELETED, true, NOW.minusDays(3), null, null, "pending");
        assertEquals(BranchLifecycleRules.OUTCOME_DONE, r.outcome);
        assertNull(r.pendingReason);
    }

    @Test
    void humanCancelWinsOverMergeEvidence() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                BranchLifecycleRules.REMOTE_DELETED, true, NOW.minusDays(3), "canceled", NOW.minusDays(1), "open");
        assertEquals(BranchLifecycleRules.OUTCOME_CANCELED, r.outcome);
        assertNull(r.pendingReason);
    }

    @Test
    void closedBranchWithNewCommitReturnsToPendingButKeepsDecision() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                BranchLifecycleRules.REMOTE_ACTIVE, false, NOW.minusHours(1), "canceled", NOW.minusDays(1), "canceled");
        assertEquals(BranchLifecycleRules.OUTCOME_PENDING, r.outcome);
        assertEquals(BranchLifecycleRules.PENDING_CLOSED_NEW_COMMIT, r.pendingReason);
        /* 规则只负责状态；判定本身由同步引擎保留，不清 decision */
        assertTrue(BranchLifecycleRules.hasNewCommitAfterDecision(
                BranchLifecycleRules.REMOTE_ACTIVE, NOW.minusHours(1), NOW.minusDays(1)));
    }

    @Test
    void oldRemoteCommitDoesNotReopenClosedBranch() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                BranchLifecycleRules.REMOTE_ACTIVE, false, NOW.minusDays(2), "ignored", NOW.minusDays(1), "ignored");
        assertEquals(BranchLifecycleRules.OUTCOME_IGNORED, r.outcome);
    }

    @Test
    void humanDoneStaysDoneEvenIfRemoteHasNewerCommit() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                BranchLifecycleRules.REMOTE_ACTIVE, false, NOW.minusHours(1), "done", NOW.minusDays(1), "done");
        assertEquals(BranchLifecycleRules.OUTCOME_DONE, r.outcome);
        assertNull(r.pendingReason);
    }

    @Test
    void renameRequiresSameShaAndRecentSighting() {
        assertTrue(BranchLifecycleRules.isRename("abc", NOW.minusMinutes(5), "abc", NOW));
        assertFalse(BranchLifecycleRules.isRename("abc", NOW.minusMinutes(31), "abc", NOW));
        assertFalse(BranchLifecycleRules.isRename("abc", NOW.minusMinutes(5), "def", NOW));
        assertFalse(BranchLifecycleRules.isRename(null, NOW.minusMinutes(5), "abc", NOW));
    }

    @Test
    void importPolicyManualAllRecent90() {
        assertFalse(BranchLifecycleRules.shouldImport("manual", "main", "feature/a", NOW.minusDays(1), NOW));
        assertTrue(BranchLifecycleRules.shouldImport("all", "main", "feature/a", null, NOW));
        assertTrue(BranchLifecycleRules.shouldImport("recent90", "main", "feature/a", NOW.minusDays(89), NOW));
        assertFalse(BranchLifecycleRules.shouldImport("recent90", "main", "feature/a", NOW.minusDays(91), NOW));
        assertFalse(BranchLifecycleRules.shouldImport("recent90", "main", "feature/a", null, NOW));
    }

    @Test
    void defaultTargetIsNeverImported() {
        assertFalse(BranchLifecycleRules.shouldImport("all", "main", "main", NOW, NOW));
        assertFalse(BranchLifecycleRules.shouldImport("recent90", "release/1.0", "release/1.0", NOW, NOW));
    }

    @Test
    void missingRemoteFactsKeepCurrentOutcome() {
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(null, false, null, null, null, "done");
        assertEquals("done", r.outcome);
        assertNull(r.pendingReason);
    }
}
