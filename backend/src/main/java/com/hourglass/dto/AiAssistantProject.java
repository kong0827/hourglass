package com.hourglass.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 助手可见/可写项目的最小视图（仍按项目级权限过滤） */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiAssistantProject {

    private String id;
    private String name;
}
