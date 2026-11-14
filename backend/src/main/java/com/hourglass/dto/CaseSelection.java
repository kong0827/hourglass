package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;
import java.util.List;

/**
 * 批量动作的作用范围：要么给明确 ID（勾选已加载的行），要么给筛选条件
 * （「全选筛选结果」，含未加载的行）。excludeIds 承载全选后取消勾选的行。
 */
@Data
public class CaseSelection {

    @Size(max = 200, message = "单次最多勾选 200 条")
    private List<String> ids;

    /** true = 按 filter 命中的全部用例生效（不受分页限制） */
    private boolean allFiltered;

    private CaseQuery filter;

    @Size(max = 500, message = "取消勾选的行最多 500 条")
    private List<String> excludeIds;
}