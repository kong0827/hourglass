package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 新建 / 编辑模块目录节点 */
@Data
public class TestModuleSaveRequest {

    /** 新建时必填；编辑时忽略（目录不跨项目移动） */
    private String reqId;

    @NotBlank(message = "请填写目录名称")
    @Size(max = 50, message = "目录名称最多 50 字")
    private String name;

    /** 父节点 ID；空 = 顶级 */
    private String parentId;
}