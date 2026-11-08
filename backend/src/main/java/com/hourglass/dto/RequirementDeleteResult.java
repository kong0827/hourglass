package com.hourglass.dto;

import lombok.Data;

/** 删除项目的结果：解绑任务数 + 连带删除的文档/版本/需求池数量（前端确认/提示用） */
@Data
public class RequirementDeleteResult {

    /** 项目名称（影响预览回传，前端做"输入项目名确认"时核对用） */
    private String name;
    private int unlinked;
    private int docs;
    private int versions;
    private int demands;
    /** 连带删除的测试用例数（A5 影响预览与删除结果口径一致） */
    private int cases;
}
