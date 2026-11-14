package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/**
 * AI 生成的投入工作总结。
 *
 * <p>与周报一致：正文是纯文本 Markdown（不带 ``` 围栏），数字全部由服务端算好塞进提示词，
 * 模型只负责把事实写成可读的总结，不得自行加总或编造。source 里的统计用来告诉用户
 * 「这份总结基于多少人、多少条工作项」，也方便排查模型是否漏人。
 */
@Data
public class AiInvestmentSummaryResponse {

    /** yyyy-MM-dd */
    private String from;
    private String to;
    /** 周期 / 范围的可读标签 */
    private String label;
    /** Markdown 正文 */
    private String report;
    private Source source = new Source();
    private AiUsage usage;

    @Data
    public static class Source {
        /** 参与总结的成员数 */
        private int members;
        /** 喂给模型的工作项条数（各成员 Top 之和） */
        private int items;
        /** 本期实际工时（分钟），服务端统计 */
        private int actualMinutes;
        /** 是否有成员的工作项被截断（只喂了 Top N） */
        private boolean truncated;
        /** 被截断的成员名（用于在抽屉里点名告知，避免用户误以为总结覆盖全部工作项） */
        private List<String> truncatedNames;
        /** 每个成员喂给模型的工作项上限 */
        private int perMember;
        /** 实际喂进去的字符数 */
        private int chars;
        /** 用户有没有写补充说明 */
        private boolean withNote;
    }
}