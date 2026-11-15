package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

/** 分类默认可见范围：只影响之后在该分类新建的文档，不改动已有文档 */
@Data
public class DocCategoryVisibilityRequest {

    @Pattern(regexp = "team|members|personal", message = "可见范围只能是 team / members / personal")
    private String visibility;

    @Size(max = 50, message = "指定成员最多 50 位，请改用团队共享")
    private List<String> memberIds;
}
