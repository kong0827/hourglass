package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class TaskSaveRequest {

    /** 选填：导入/撤销删除时由前端指定 ID，不填则服务端生成 */
    @Size(max = 32, message = "任务ID不合法")
    private String id;

    @NotBlank(message = "请填写任务标题")
    @Size(max = 60, message = "任务标题不能超过 60 字")
    private String title;

    @Size(max = 200, message = "任务描述不能超过 200 字")
    private String description;

    @Pattern(regexp = "P0|P1|P2|P3", message = "优先级不合法")
    private String priority;

    @Size(max = 32, message = "负责人不能超过 32 字")
    private String owner;

    /** N-2 身份绑定：负责人账号ID（可与 owner 显示名同时提交；为空则只按显示名文本处理） */
    @Size(max = 32, message = "负责人账号ID不合法")
    private String ownerUserId;

    /** 分类名（取值来自空间分类表；不填则用空间第一个分类） */
    @Size(max = 16, message = "分类不能超过 16 字")
    private String category;

    /** 看板列 id：内置 backlog/doing/done 或自定义列（C 开头）；存在性由服务层校验 */
    @Pattern(regexp = "^[A-Za-z0-9_-]{1,16}$", message = "所在列不合法")
    private String boardColumn;

    /** 开始日期 yyyy-MM-dd，选填。填了之后日历会按 [开始, 截止] 区间每天展示该任务 */
    private LocalDate startDate;

    /** yyyy-MM-dd，选填 */
    private LocalDate dueDate;

    @Size(max = 32, message = "所属项目ID不合法")
    private String reqId;

    /** 关联需求 ID（requirement_doc）；需求必须属于上面那个项目 */
    @Size(max = 32, message = "关联需求ID不合法")
    private String reqDocId;

    /** 关联分支 ID（dev_branch，空间级）；为空表示不关联分支 */
    @Size(max = 32, message = "关联分支ID不合法")
    private String branchId;

    @Min(value = 0, message = "进度不能小于 0")
    @Max(value = 100, message = "进度不能大于 100")
    private Integer progress;

    /** 里程碑：单日节点（甘特图菱形），不展示进度条 */
    private Boolean isMilestone;

    /**
     * 预估耗时（分钟，空=没估）。0 与空等价，都表示"没填"。
     * 上限 10080 分钟（168 小时）—— 单任务估到一周以上说明该拆了。
     */
    @Min(value = 0, message = "预估耗时不能为负")
    @Max(value = 10080, message = "预估耗时不能超过 168 小时")
    private Integer estimateMinutes;

    @Size(max = 80, message = "进度备注不能超过 80 字")
    private String note;

    /** 循环：daily/weekly/monthly；空字符串=清除循环，null=不变（新增时为不循环） */
    @Pattern(regexp = "daily|weekly|monthly|", message = "循环类型不合法")
    private String recurType;

    /** 任务级提醒时间 yyyy-MM-ddTHH:mm */
    private LocalDateTime remindAt;

    /** N-1 提醒谁：owner（仅负责人）/ owner+admin（负责人 + 空间主） */
    @Pattern(regexp = "owner|owner\\+admin|", message = "提醒对象不合法")
    private String remindTarget;

    /** N-4 阻塞 / 卡点 */
    private Boolean blocked;

    @Size(max = 120, message = "卡点原因不能超过 120 字")
    private String blockedReason;

    @Size(max = 32, message = "等待的任务ID不合法")
    private String blockedByTaskId;

    /** 标签（最多 8 个，每个 ≤16 字） */
    @Size(max = 8, message = "标签最多 8 个")
    private List<String> tags;

    /** 选填：仅新增（撤销删除恢复）时可指定原完成日期 */
    private LocalDate completedAt;

    /** 选填：撤销删除恢复时一并重建的子任务 */
    private List<SubtaskItem> subtasks;

    @lombok.Data
    public static class SubtaskItem {
        private String title;
        private Boolean done;
    }
}
