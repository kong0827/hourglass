package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import java.util.List;

/** 同级分组手动排序：整体提交同一父级下的分组顺序 */
@Data
public class CaseSetOrderRequest {

    @NotBlank(message = "请选择所属项目")
    private String reqId;

    /** 父分组 ID；空串 = 顶级 */
    private String parentId;

    @NotEmpty(message = "排序列表不能为空")
    private List<String> ids;
}
