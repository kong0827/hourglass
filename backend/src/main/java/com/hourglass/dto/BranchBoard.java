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
    /** 生命周期条数（open/done/canceled/ignored/pending）+ all，忽略 outcome 条件 */
    private Map<String, Integer> outcomeCounts = new LinkedHashMap<String, Integer>();
    /** 仓库条数：key = repoId，未绑定仓库的分支记在 __none__，另有 all */
    private Map<String, Integer> repoCounts = new LinkedHashMap<String, Integer>();
    private Double avgCycleDays;

    @Data
    public static class Column {
        private List<DevBranch> items = new ArrayList<DevBranch>();
        private int matched;
        private boolean hasMore;
    }
}
