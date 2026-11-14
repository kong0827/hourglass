package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;
import java.util.List;

/** 按筛选圈选入计划：筛选条件即范围，自动去重已在计划内的用例 */
@Data
public class PlanFilterRequest {

    private CaseQuery filter;

    @Size(max = 500, message = "取消勾选的行最多 500 条")
    private List<String> excludeIds;

    /** 加入后是否标记「发布必测」；null = 不标记 */
    private Boolean required;

    /** true = 只返回匹配 / 已在计划 / 本次新增条数，不写入（确认弹窗用） */
    private boolean dryRun;
}