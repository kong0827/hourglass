package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** AI 生成测试用例的结果（草稿，不落库） */
@Data
public class AiTestCaseResponse {

    private String reqId;
    /** doc / demand */
    private String source;
    private String sourceId;
    private String sourceTitle;
    /** 读取到的来源正文字数（截断前） */
    private int sourceChars;
    /** 正文过长时只喂了前若干字 */
    private boolean truncated;
    private List<AiCaseDraft> cases = new ArrayList<AiCaseDraft>();
    private AiUsage usage;
}
