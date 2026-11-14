package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 新建 / 编辑文档分类节点 */
@Data
public class DocCategorySaveRequest {

    /** 所属项目 ID；空 = 空间级分类。新建时决定归属，编辑时忽略（分类不跨范围移动） */
    @Size(max = 32, message = "所属项目不合法")
    private String reqId;

    @NotBlank(message = "请填写分类名称")
    @Size(max = 50, message = "分类名称最多 50 字")
    private String name;

    /** 父分类 ID；空 = 顶级 */
    @Size(max = 32, message = "上级分类不合法")
    private String parentId;
}