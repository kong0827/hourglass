package com.hourglass.dto;

import lombok.Data;

/** 活动聚合按实体类型的条数。 */
@Data
public class ActivityTypeCount {

    private String type;
    private int total;
}
