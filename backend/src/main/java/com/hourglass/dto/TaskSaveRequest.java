package com.hourglass.dto;

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

    private String description;

    @Pattern(regexp = "P0|P1|P2|P3", message = "优先级不合法")
    private String priority = "P2";

    @Size(max = 32, message = "负责人不能超过 32 字")
    private String owner;

    /** N-2 身份绑定：负责人账号ID（可与 owner 显示名同时提交；为空则只按显示名文本处理） */
    @Size(max = 32, message = "负责人账号ID不合法")
    private String ownerUserId;

    /** 模块ID（category.id；不填则用空间第一个模块） */
    @Size(max = 32, message = "模块ID不合法")
    private String categoryId;

    /** 看板列 id：内置 backlog/doing/test/testing/done 或自定义列（C 开头）；存在性由服务层校验 */
    @Pattern(regexp = "^[A-Za-z0-9_-]{1,16}$", message = "所在列不合法")
    private String boardColumn = "backlog";

    /** 开始日期 yyyy-MM-dd，选填。填了之后日历会按 [开始, 截止] 区间每天展示该任务 */
    private LocalDate startDate;

    /** yyyy-MM-dd，选填 */
    private LocalDate dueDate;

    @Size(max = 32, message = "所属项目ID不合法")
    private String reqId;

    /** 关联需求 ID（requirement_doc）；需求必须属于上面那个项目 */
    @Size(max = 32, message = "关联文档ID不合法")
    private String reqDocId;

    /** 关联分支 ID（dev_branch，空间级）；为空表示不关联分支 */
    @Size(max = 32, message = "关联分支ID不合法")
    private String branchId;

    /** 工作项类型：story/task/bug/epic；空=默认 task（更新时不传保持原值） */
    @Pattern(regexp = "story|task|bug|epic|", message = "工作项类型不合法")
    private String itemType;

    /** 缺陷严重度：blocker/critical/major/minor；仅 itemType=bug 时必填（更新时不传保持原值） */
    @Pattern(regexp = "blocker|critical|major|minor|", message = "缺陷严重度不合法")
    private String severity;

    /** 发现环境（仅缺陷；更新时不传保持原值，空串=清空） */
    @Size(max = 120, message = "发现环境不能超过 120 字")
    private String environment;

    /** 复现步骤（仅缺陷；更新时不传保持原值，空串=清空） */
    @Size(max = 2000, message = "复现步骤不能超过 2000 字")
    private String reproduceSteps;

    /** 发现版本ID（仅缺陷，须属于任务所选项目；更新时不传保持原值，空串=清空） */
    @Size(max = 32, message = "发现版本不合法")
    private String foundVersionId;

    /** 回归状态：pending/passed/failed（仅缺陷；更新时不传保持原值，空串=清空） */
    @Pattern(regexp = "pending|passed|failed|", message = "回归状态不合法")
    private String regressionStatus;

    /** 所属 Epic 任务ID（须为同空间 item_type=epic 的任务）；空=清除归属（更新时不传保持原值） */
    @Size(max = 32, message = "所属史诗不合法")
    private String epicId;

    /** 规划版本：null 保留已有关系（创建时继承需求目标），空数组明确解除全部绑定。 */
    @Size(max = 100, message = "影响版本最多 100 个")
    private List<String> versionIds;

    /** 已有任务调整版本，以及创建时偏离需求目标版本的原因。 */
    private String versionChangeReason;

    /** 关联需求池需求ID（demand，须属于任务所选项目）；空=解除关联（更新时不传保持原值） */
    @Size(max = 32, message = "关联需求不合法")
    private String demandId;

    @Min(value = 0, message = "进度不能小于 0")
    @Max(value = 100, message = "进度不能大于 100")
    private Integer progress = 0;

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

    /** 抽屉里改列且流转规则要求原因时必填；原因写入移动日志 */
    private String moveReason;

    /** 抽屉里改列时，空间主 / 管理员强制越过「禁止」规则 */
    private Boolean force;

    /** 保存时回传打开抽屉时的 updatedAt，用于检测并发覆盖（0 行更新返回 409） */
    private LocalDateTime oldUpdatedAt;

    @lombok.Data
    public static class SubtaskItem {
        private String title;
        private Boolean done;
    }
}
