package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 需求池评审流转请求（pass/rej/plan/reopen）：note 为拒绝原因/排期说明等留痕 */
@Data
public class DemandActionRequest {

    private String note;

    /** 仅 plan 需要：排入的目标版本 */
    private String versionId;

    /** 仅 plan 可带：期望随排期一起调整的交付时间 */
    private LocalDate expectDate;
}
