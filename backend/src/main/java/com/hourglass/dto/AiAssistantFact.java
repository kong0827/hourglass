package com.hourglass.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 只读查询的结论摘要：一个指标或一条可点开的记录，前端只负责渲染 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiAssistantFact {

    private String label;
    private String value;
    /** normal / good / warn / danger */
    private String tone;
    /** 可选深链；只由服务端生成，不接受模型拼装 */
    private String href;
}
