package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 里程碑读模型：达成状态由条件/证据推导，前端不自行判断。
 * achieved_rolled_back 只用于版本型：达成后发生回滚，证据与达成时间保留。
 * evidence_missing 只用于工作项型：关联工作项已删除或移出项目，证据不全，不能自动达成。
 */
@Data
public class MilestoneView {

    private String id;
    private String reqId;
    private String name;
    private String kind;
    private String versionId;
    private String versionName;
    private LocalDate targetDate;
    private String ownerUserId;
    private String ownerName;
    private Boolean keyMilestone;
    private String note;
    /** pending / achieved / overdue / canceled / achieved_rolled_back / evidence_missing */
    private String status;
    private LocalDateTime achievedAt;
    private String achievedSource;
    private String achievedNote;
    private String confirmedByUserId;
    private String confirmedByName;
    private LocalDateTime canceledAt;
    private String cancelReason;
    private Long revision;

    /** 工作项型：关联与完成进度；taskCount 按关联条数计，缺失的关联工作项计入 missingTaskCount */
    private List<MilestoneTask> tasks = new ArrayList<MilestoneTask>();
    private Integer taskCount;
    private Integer doneTaskCount;
    private Integer missingTaskCount;
    /** 版本型：production 成功记录 */
    private String releaseRecordId;
    private LocalDateTime releaseAt;
    private Integer releaseCount;
    /** 版本型：达成后是否发生回滚 */
    private Boolean rolledBack;
    private List<MilestoneLog> logs = new ArrayList<MilestoneLog>();

    @Data
    public static class MilestoneTask {
        private String id;
        private String title;
        private String boardColumn;
        private LocalDateTime completedAt;
    }

    @Data
    public static class MilestoneLog {
        private String action;
        private String detail;
        private String operatorUserId;
        private String operatorName;
        private LocalDateTime createdAt;
    }
}
