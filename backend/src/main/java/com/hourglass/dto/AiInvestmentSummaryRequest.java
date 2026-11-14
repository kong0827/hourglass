package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 投入结构 AI 总结请求：沿用报表的周期与筛选，圈人可选，补充说明可选。 */
@Data
public class AiInvestmentSummaryRequest {
    private String from;
    private String to;
    private String reqId;
    private String roleTitle;
    private String companyName;
    private List<String> memberUserIds;
    private String note;
}