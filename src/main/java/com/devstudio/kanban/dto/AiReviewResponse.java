package com.devstudio.kanban.dto;

import lombok.Data;

/**
 * AI 润色后的周报。
 *
 * <p>正文是**纯文本 Markdown**（不带 ``` 围栏），前端按 pre-wrap 直接显示、一键复制 ——
 * 周报的终点是"粘到 IM / 邮件里"，所以不给 HTML：带标签的文本粘过去满屏都是尖括号。
 *
 * <p>source 里的数字由服务端算（不取模型说的），用来告诉用户"这份周报是基于多少条事实写的"，
 * 也方便排查"模型是不是漏了一半任务"。
 */
@Data
public class AiReviewResponse {

    private Integer weekOffset;
    /** 本周 / 上周 / 该周期 */
    private String label;
    /** yyyy-MM-dd */
    private String weekStart;
    private String weekEnd;
    /** Markdown 正文 */
    private String report;
    /** 喂给模型的事实条数，界面上说明"基于 N 条记录" */
    private Source source = new Source();
    private AiUsage usage;

    @Data
    public static class Source {
        private int completed;
        private int progress;
        private int pendingDone;
        /** 任务清单是否被截断（太长时只喂前面一部分） */
        private boolean truncated;
        /** 实际喂进去的字符数 */
        private int chars;
        /** 用户有没有写补充说明 */
        private boolean withNote;
    }
}
