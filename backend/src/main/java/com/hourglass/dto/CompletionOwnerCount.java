package com.hourglass.dto;

import lombok.Data;

/** 完成记录参与者计数，用于“参与成员 · 最多：某某 N 项”。 */
@Data
public class CompletionOwnerCount {

    private String owner;
    private int ownerCount;
}
