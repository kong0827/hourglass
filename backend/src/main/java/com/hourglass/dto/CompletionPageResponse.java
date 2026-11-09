package com.hourglass.dto;

import com.hourglass.entity.TaskCompletionRecord;
import lombok.Data;

import java.util.List;

/** 月度完成记录分页：明细按页下发，汇总与参与成员由服务端计算。 */
@Data
public class CompletionPageResponse {

    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    private List<TaskCompletionRecord> items;
    private int totalMinutes;
    private int ownerCount;
    private String topOwner;
    private int topOwnerCount;
}
