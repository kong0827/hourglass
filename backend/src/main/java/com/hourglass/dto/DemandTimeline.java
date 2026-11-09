package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** 需求时间轴：阶段区间按时间顺序排列，缺失阶段不补 0 天 */
@Data
public class DemandTimeline {

    /** 首尾阶段并集（并行阶段不重复计时） */
    private LocalDate start;
    private LocalDate end;
    private int days;
    private List<DemandStage> stages = new ArrayList<DemandStage>();
    /** 关联文档 / 已完成发布数 */
    private int docCount;
    private int docPublished;
    /** 关联工作项 / 已完成数 */
    private int taskCount;
    private int taskDone;
    /** 关联用例总数 / 从未执行数 / 执行过但最近一次未通过数；casePending = 未执行 + 未通过 */
    private int caseCount;
    private int caseUntested;
    private int caseFailed;
    private int casePending;
    /** Immutable actual events; never inferred from the current target version. */
    private List<com.hourglass.entity.VersionRelease> releaseRecords = new ArrayList<com.hourglass.entity.VersionRelease>();
    private int productionEffectiveTaskCount;
    private int productionPartialTaskCount;
    private int publicationUnknownTaskCount;
    /** Delivery evidence does not constitute demand acceptance. */
    private String acceptanceState = "not_recorded";
}
