package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import java.util.List;

/** 用例手动排序：ids 必须是当前目录范围（含子目录时按同一范围）的全部用例，按提交顺序重编号 */
@Data
public class CaseOrderRequest {

    @NotBlank(message = "请选择所属项目")
    private String reqId;

    /** 目录节点 ID；__none = 未归类；空 = 全部用例 */
    private String moduleId;

    /** 是否包含子目录用例（与列表筛选同口径） */
    private boolean moduleSub;

    @NotEmpty(message = "排序列表不能为空")
    private List<String> ids;
}
