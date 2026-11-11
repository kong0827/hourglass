package com.hourglass.dto;

import lombok.Data;

/** 只读查询结果行：只下发前端渲染，不进对话历史与提示词 */
@Data
public class AiAssistantTaskItem {

    private String id;
    private String title;
    private String projectName;
    private String columnName;
    private String dueDate;
    private boolean blocked;
    private String href;
}
