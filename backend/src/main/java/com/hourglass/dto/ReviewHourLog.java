package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 周回顾工时下钻的一行：一条已结束的计时记录。 */
@Data
public class ReviewHourLog {

    private Long id;
    private LocalDate date;
    private String userId;
    /** 计时人显示名；成员退出空间后仍按账号名展示 */
    private String member;
    private String taskId;
    private String title;
    private String reqName;
    private Integer minutes;
    private String origin;
}
