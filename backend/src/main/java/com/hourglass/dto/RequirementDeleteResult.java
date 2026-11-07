package com.hourglass.dto;

import lombok.Data;

/** 删除项目的结果：解绑任务数 + 连带删除的文档/版本/需求池数量（前端确认/提示用） */
@Data
public class RequirementDeleteResult {

    private int unlinked;
    private int docs;
    private int versions;
    private int demands;
}
