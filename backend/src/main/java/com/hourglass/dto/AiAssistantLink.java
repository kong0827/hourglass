package com.hourglass.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 助手可展示的入口；href 必须命中服务端白名单 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiAssistantLink {

    private String label;
    private String href;
}
