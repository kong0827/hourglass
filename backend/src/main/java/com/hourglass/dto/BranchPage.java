package com.hourglass.dto;

import com.hourglass.entity.DevBranch;
import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 分支分页结果：total 为当前筛选下的总数（与 offset/limit 无关） */
@Data
public class BranchPage {

    private String status;
    private int total;
    private int offset;
    private int limit;
    private List<DevBranch> items = new ArrayList<DevBranch>();
    private boolean hasMore;
    /** 各状态条数（dev/testing/merging/released）+ all，忽略 status 条件 */
    private Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
    /** 已发布分支的平均发布周期（天），没有可计算样本时为 null */
    private Double avgCycleDays;
}
