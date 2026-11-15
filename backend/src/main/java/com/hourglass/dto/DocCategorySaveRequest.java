package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

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

    /** 默认可见范围：仅新建时生效；改名忽略，改默认走 PUT /api/doc-categories/{id}/visibility */
    @Pattern(regexp = "team|members|personal", message = "可见范围只能是 team / members / personal")
    private String visibility;

    /** 默认指定成员名单：仅新建且 visibility=members 时生效 */
    @Size(max = 50, message = "指定成员最多 50 位，请改用团队共享")
    private List<String> memberIds;
}