package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 新建需求 / 缺陷时的相似条目检查：只读，不落库 */
@Data
public class SimilarCheckRequest {

    /** demand / defect */
    @NotBlank(message = "缺少检查类型")
    @Size(max = 16)
    private String kind;

    /** 当前表单选中的项目；为空时只按可见项目过滤 */
    @Size(max = 32)
    private String projectId;

    @NotBlank(message = "缺少标题")
    @Size(max = 200)
    private String title;

    /** 表单里的描述；只用于提高排序，不落库 */
    @Size(max = 4000)
    private String description;

    /** 编辑态要排除的自身 id（新建时为空） */
    @Size(max = 32)
    private String excludeId;
}
