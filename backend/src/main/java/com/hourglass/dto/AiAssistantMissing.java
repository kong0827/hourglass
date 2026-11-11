package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 服务端盘点出的缺失字段；options 为空表示需要用户自由输入 */
@Data
public class AiAssistantMissing {

    private String field;
    private String label;
    private List<AiAssistantOption> options = new ArrayList<AiAssistantOption>();
}
