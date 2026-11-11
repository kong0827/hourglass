package com.hourglass.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 缺失字段的候选项；只来自服务端已校验的集合 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiAssistantOption {

    private String value;
    private String label;
}
