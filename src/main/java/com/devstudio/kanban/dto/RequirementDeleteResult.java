package com.devstudio.kanban.dto;

import lombok.Data;

/** 删除项目的结果：解绑任务数 + 连带删除的需求文档数（前端确认/提示用） */
@Data
public class RequirementDeleteResult {

    private int unlinked;
    private int docs;
}
