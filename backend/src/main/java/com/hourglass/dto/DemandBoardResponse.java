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
    private Map<String, Integer> counts = new LinkedHashMap<String, Integer>();

    @Data
    public static class Column {
        private List<Demand> items = new ArrayList<Demand>();
        /** 该状态总数，与首屏条数无关 */
        private int matched;
        private boolean hasMore;
    }
}
