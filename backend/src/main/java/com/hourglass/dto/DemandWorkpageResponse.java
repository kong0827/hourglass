package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 主状态工作页与交付驾驶舱：明细分页，统计和筛选项由服务端聚合。 */
@Data
public class DemandWorkpageResponse {

    private DemandPage page;
    private Map<String, Integer> statusCounts = new LinkedHashMap<String, Integer>();
    private Map<String, Integer> stageCounts = new LinkedHashMap<String, Integer>();
    private Map<String, Object> metrics = new LinkedHashMap<String, Object>();
    private List<Map<String, Object>> versions = new ArrayList<Map<String, Object>>();
}
