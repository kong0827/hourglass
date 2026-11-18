package com.hourglass.dto;

import lombok.Data;

/** 报表「当前积压」：按看板列计数 + 逾期 */
@Data
public class TaskBucketRow {

    private int backlog;
    private int doing;
    private int done;
    /** 自定义列 */
    private int other;
    private int overdue;
    /** 终态「已取消」：不计入上面任何一个未完成桶，也不计逾期 */
    private int canceled;
}
