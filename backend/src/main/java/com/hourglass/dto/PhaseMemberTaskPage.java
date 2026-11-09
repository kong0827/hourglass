package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 成员阶段工时下钻分页：明细按页下发，首版/迭代合计由服务端同口径汇总。 */
@Data
public class PhaseMemberTaskPage {

    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    private List<PhaseMemberTask> items;
    private int mvpMinutes;
    private int postMinutes;
}
