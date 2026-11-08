package com.hourglass.dto;

import com.hourglass.entity.Demand;
import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 需求池分页结果：total 为当前筛选下的总数（与 offset/limit 无关） */
@Data
public class DemandPage {

    private int total;
    private int offset;
    private int limit;
    private List<Demand> items = new ArrayList<Demand>();
    private boolean hasMore;
    /** 各状态条数（review/pass/plan/rej）+ all，忽略 status 条件 */
    private Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
}
