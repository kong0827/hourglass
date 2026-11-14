package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 执行失败的用例转出缺陷：严重度必填，其余复用缺陷字段口径 */
@Data
public class CaseDefectRequest {

    @NotBlank(message = "缺陷必须选择严重度")
    @Pattern(regexp = "^(blocker|critical|major|minor)$", message = "严重度不合法")
    private String severity;

    @Size(max = 120, message = "发现环境最多 120 字")
    private String environment;

    /** 转缺陷补充说明：追加到缺陷描述 */
    @Size(max = 500, message = "补充说明最多 500 字")
    private String note;

    /** 是否把最近一轮失败证据复制到缺陷附件；空视为 true */
    private Boolean carryEvidence;
}
