package com.hourglass.service;

import com.hourglass.dto.DeliveryNoteResponse;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 计划维度顶层口径：同一工作项 / 需求被多个版本纳入时只计一次。 */
class PlanNoteDedupeTest {

    @Test
    void sameTaskInTwoVersionsCountsOnceWithStrongerState() {
        List<DeliveryNoteResponse.ScopeRow> scope = new ArrayList<DeliveryNoteResponse.ScopeRow>();
        scope.add(scope("T1", "released", "new", LocalDateTime.of(2026, 11, 20, 10, 0), "V1"));
        scope.add(scope("T1", "pending", "new", LocalDateTime.of(2026, 11, 20, 10, 0), "V2"));
        scope.add(scope("T2", "pending", "fix", null, "V2"));
        scope.add(scope("T3", "deferred", "improve", null, "V1"));

        DeliveryNoteResponse.Counts counts = DeliveryNoteService.dedupeCounts(scope);

        assertEquals(3, counts.getPlanned(), "两个版本重复纳入的同一工作项只计一次");
        assertEquals(1, counts.getReleased());
        assertEquals(1, counts.getDeferred());
        assertEquals(1, counts.getPending());
        assertEquals(1, counts.getDoing(), "未完成且无完成时间视为进行中");
        assertEquals(1, counts.getNewCount());
        assertEquals(1, counts.getFixCount());
        assertEquals(1, counts.getImproveCount());
        assertEquals(2, counts.getCurrentBound(), "当前绑定 = 去重总数 - 已移出");
    }

    @Test
    void doneTaskOutsideReleaseIsNotCountedAsDoing() {
        List<DeliveryNoteResponse.ScopeRow> scope = new ArrayList<DeliveryNoteResponse.ScopeRow>();
        scope.add(scope("T1", "done", null, LocalDateTime.of(2026, 11, 25, 9, 0), "V1"));
        scope.add(scope("T2", "pending", null, LocalDateTime.of(2026, 11, 26, 9, 0), "V1"));

        DeliveryNoteResponse.Counts counts = DeliveryNoteService.dedupeCounts(scope);

        assertEquals(2, counts.getDone(), "已完成但未纳入发布的项仍算已完成");
        assertEquals(0, counts.getDoing());
        assertEquals(2, counts.getUnlinkedCount());
    }

    @Test
    void sameDemandInTwoVersionsCountsOnceWithBestState() {
        List<DeliveryNoteResponse.DemandRow> rows = new ArrayList<DeliveryNoteResponse.DemandRow>();
        rows.add(demand("D1", "partial", "V1"));
        rows.add(demand("D1", "fulfilled", "V2"));
        rows.add(demand("D2", "pending", "V2"));
        rows.add(demand("D3", "deferred", "V1"));

        DeliveryNoteResponse.DemandSummary summary = DeliveryNoteService.dedupeDemandSummary(rows);

        assertEquals(3, summary.getTotal(), "同一需求跨版本只计一条");
        assertEquals(1, summary.getFulfilled());
        assertEquals(1, summary.getPending());
        assertEquals(1, summary.getDeferred());
        assertEquals(0, summary.getPartial(), "去重后按最好状态归类，不再重复计入部分兑现");
        assertEquals(33, summary.getRatePct());
    }

    @Test
    void demandWithoutIdFallsBackToTitleKey() {
        List<DeliveryNoteResponse.DemandRow> rows = new ArrayList<DeliveryNoteResponse.DemandRow>();
        DeliveryNoteResponse.DemandRow a = demand(null, "fulfilled", "V1");
        a.setTitle("登录改造");
        DeliveryNoteResponse.DemandRow b = demand(null, "pending", "V2");
        b.setTitle("登录改造");
        rows.add(a);
        rows.add(b);

        DeliveryNoteResponse.DemandSummary summary = DeliveryNoteService.dedupeDemandSummary(rows);

        assertEquals(1, summary.getTotal());
        assertEquals(1, summary.getFulfilled());
    }

    private DeliveryNoteResponse.ScopeRow scope(String id, String state, String kind,
                                                LocalDateTime completedAt, String versionId) {
        DeliveryNoteResponse.ScopeRow row = new DeliveryNoteResponse.ScopeRow();
        row.setId(id);
        row.setState(state);
        row.setKind(kind);
        row.setCompletedAt(completedAt);
        row.setVersionId(versionId);
        return row;
    }

    private DeliveryNoteResponse.DemandRow demand(String id, String state, String versionId) {
        DeliveryNoteResponse.DemandRow row = new DeliveryNoteResponse.DemandRow();
        row.setId(id);
        row.setState(state);
        row.setVersionId(versionId);
        row.setTitle("需求" + id);
        return row;
    }
}
