package com.hourglass.dto;

import lombok.Data;

/** 补记风险/变化：阻塞、延期完成、交付物。 */
@Data
public class CatchupRisk {

    private String key;
    /** warn 承诺变化 / danger 阻塞 / info 交付物 */
    private String kind;
    private String label;
    private String title;
    private String meta;
    private String quote;
    private String decision;
    private String taskId;
    private String planId;
    /** 阻塞风险可一键解除时，带上当前原因 */
    private String reason;
}
