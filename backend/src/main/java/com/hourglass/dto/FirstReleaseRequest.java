package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 标记首版上线请求；date 不填默认当天 */
@Data
public class FirstReleaseRequest {

    private LocalDate date;
}
