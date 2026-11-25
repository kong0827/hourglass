package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/** 需求池提交/编辑（T2.1）：WSJF 四分量只能填 0-10 原始分，得分由服务端计算 */
@Data
public class DemandSaveRequest {

    /** 所属项目ID（需求池按项目归属） */
    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目ID不合法")
    private String reqId;

    @NotBlank(message = "请填写需求标题")
    @Size(max = 80, message = "需求标题不能超过 80 字")
    private String title;

    @Size(max = 2000, message = "需求描述不能超过 2000 字")
    private String description;

    /** 来源（谁提的，如「财务 · 刘」） */
    @Size(max = 40, message = "来源不能超过 40 字")
    private String source;

    @Pattern(regexp = "新功能|体验优化|缺陷|其他", message = "需求类型不合法")
    private String itemKind;

    /** 模块ID（category.id；不填=未指定） */
    @Size(max = 32, message = "分类ID不合法")
    private String categoryId;

    @Pattern(regexp = "P0|P1|P2|P3", message = "优先级不合法")
    private String priority;

    private LocalDate expectDate;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;

    /** 编辑时必填，创建时由服务端初始化为 0 */
    @Min(value = 0, message = "revision 不合法")
    private Long revision;

    @Size(max = 2000, message = "验收标准不能超过 2000 字")
    private String acceptText;

    @Min(value = 0, message = "业务价值不能小于 0")
    @Max(value = 10, message = "业务价值不能大于 10")
    private Integer wsjfBusiness;

    @Min(value = 0, message = "时间紧迫度不能小于 0")
    @Max(value = 10, message = "时间紧迫度不能大于 10")
    private Integer wsjfUrgency;

    @Min(value = 0, message = "风险降低/机会不能小于 0")
    @Max(value = 10, message = "风险降低/机会不能大于 10")
    private Integer wsjfRisk;

    @Min(value = 1, message = "工作量不能小于 1")
    @Max(value = 10, message = "工作量不能大于 10")
    private Integer wsjfEffort;

    /** 创建时预置的提醒人：只在创建生效，编辑不改名单；提交人与重复项自动忽略 */
    @Size(max = 20, message = "提醒人最多 20 人")
    private List<String> watcherIds;

    /** 评审人账号ID：可空；必须能查看该项目。只在创建/待评审整单编辑时生效 */
    @Size(max = 32, message = "评审人ID不合法")
    private String reviewerUserId;
}
