package com.hourglass.dto;

import com.hourglass.entity.Demand;
import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 需求池看板：每个状态一列，只下发首屏条目，其余通过 /api/demands/page 滚动加载 */
@Data
public class DemandBoardResponse {

    /** key: review/pass/plan/rej */
    private Map<String, Column> columns = new LinkedHashMap<String, Column>();
    /** 当前筛选下的各状态计数；all 为匹配总数 */
    private Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
    /** 同一项目范围内不做搜索/筛选的总数，用于「匹配 M / N」 */
    private int totalAll;
    /**
     * 看板筛选项计数：pris / kinds / cats → 取值 → 条数。
     * 范围 = 当前项目 + 搜索词，不叠加优先级/类型/模块条件，选中某项后同维度其他选项不会消失。
     */
    private Map<String, Map<String, Integer>> facets = new LinkedHashMap<String, Map<String, Integer>>();

    @Data
    public static class Column {
        private List<Demand> items = new ArrayList<Demand>();
        /** 该状态总数，与首屏条数无关 */
        private int matched;
        private boolean hasMore;
    }
}
