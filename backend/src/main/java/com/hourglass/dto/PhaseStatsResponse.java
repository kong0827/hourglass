package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * M1 阶段双统计（T1.4）：首版/迭代自动归组。
 * 归组口径：完成任务按完成日 vs 首版上线日；未完成任务按开始日（无开始日用截止日）。
 * 上线日未标记（firstReleasedAt = null）时全部归入首版。
 * 工时按 time_log 的自然日归组；「新增需求/缺陷维护」拆分依赖 task.item_type（story/bug）。
 */
@Data
public class PhaseStatsResponse {

    private String reqId;
    private String reqName;
    /** 首版上线日；null = 尚未标记上线（首版开发进行中） */
    private LocalDate firstReleasedAt;

    private Phase mvp = new Phase();
    private Phase post = new Phase();

    @Data
    public static class Phase {
        /** 累计实际工时（分钟） */
        private Integer workMinutes;
        private Integer doneTasks;
        /** 有工时投入的成员数 */
        private Integer memberCount;
        /** 人均工时（分钟）：workMinutes ÷ memberCount；无成员时为 null */
        private Integer avgMemberMinutes;
        /** 整体偏差百分比：(实际−预估)÷预估（按任务归组的口径）；无预估数据时为 null */
        private Integer deviationPct;
        /** 准时完成率：有截止日的完成任务中 completed_at ≤ due_date 的占比；无数据时为 null */
        private Integer onTimePct;
        /** 任务均耗时（分钟）：完成任务自身工时合计 ÷ doneTasks；无完成任务时为 null */
        private Integer avgTaskMinutes;
        /** 新增需求数：本阶段完成的 story 任务数 */
        private Integer storyCount;
        /** 缺陷维护数：本阶段完成的 bug 任务数 */
        private Integer bugCount;
        private List<MemberHours> memberHours = new ArrayList<MemberHours>();
    }

    @Data
    public static class MemberHours {
        private String userId;
        private String name;
        private Integer minutes;
    }
}
