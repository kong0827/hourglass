package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

/** 批量人工判定：逐条校验项目写权限，单条失败不中断整批。 */
@Data
public class BranchOutcomeBatchRequest {

    @NotEmpty(message = "请选择分支")
    @Size(max = 200, message = "一次最多处理 200 条分支")
    private List<String> ids;

    @Pattern(regexp = "done|canceled|ignored|", message = "人工判定只能是 done / canceled / ignored")
    private String decision;

    @Size(max = 32, message = "理由不能超过 32 字")
    private String reason;

    @Size(max = 200, message = "备注不能超过 200 字")
    private String note;
}
