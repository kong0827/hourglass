package com.hourglass.dto;

import lombok.Data;

/** GROUP BY 名称的计数行（分类 / 负责人分布） */
@Data
public class NameCountRow {

    private String name;
    private int cnt;
}
