package com.hourglass.dto;

import lombok.Data;

/** 补记决策请求：工作项草稿或风险卡片。 */
@Data
public class CatchupDecisionRequest {

    /** 本周任意一天，服务端归一到周一；空=本周 */
    private String week;
    private String draftKey;
    /** work / risk */
    private String kind;
    /** accept/skip/merge/edit/answer/confirm/record/ignore/unblock */
    private String action;
    private String answer;
    private String title;
    private String note;
}
