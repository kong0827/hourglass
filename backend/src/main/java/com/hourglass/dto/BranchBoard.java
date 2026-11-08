package com.hourglass.dto;

import com.hourglass.entity.DevBranch;
import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 分支看板：每个状态先给一屏，滚动加载走 /api/branches/page */
@Data
public class BranchBoard {

    private Map<String, Column> columns = new LinkedHashMap<String, Column>();
    /** 各状态条数 + all */
    private Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
    private Double avgCycleDays;

    @Data
    public static class Column {
        private List<DevBranch> items = new ArrayList<DevBranch>();
        private int matched;
        private boolean hasMore;
    }
}
