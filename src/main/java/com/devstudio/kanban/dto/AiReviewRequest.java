package com.devstudio.kanban.dto;

import lombok.Data;

/**
 * AI 润色周报的入参。
 *
 * <p>为什么周偏移放在 body 里而不是 query：前端切周、重新生成、复制都走同一个接口，
 * 用一个对象传参比拼 query 少一层编码坑（周偏移可能是 -3、0 这样的负数）。
 */
@Data
public class AiReviewRequest {

    /** 0 = 本周，-1 = 上周，以此类推；不传按「有数据的那一周」自动判断（与回顾页一致） */
    private Integer weekOffset;

    /**
     * 用户补充的、任务里体现不出来的事（可留空）。
     * 模型只看得到任务/进度/工时，看不到"周三线上排查""跟客户对了口径"这类事，
     * 留一个口子比让它瞎猜好。
     */
    private String note;
}
