package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 测试用例分页结果；facets 供筛选下拉使用（不受当前筛选影响） */
@Data
public class TestCasePage {

    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    private List<TestCaseView> items = new ArrayList<TestCaseView>();
    private List<String> modules = new ArrayList<String>();
    private List<String> owners = new ArrayList<String>();
    /** 筛选项计数：键为空值类时使用 __none / __untested，不受当前筛选影响 */
    private Map<String, Integer> moduleCounts = new LinkedHashMap<String, Integer>();
    private Map<String, Integer> priorityCounts = new LinkedHashMap<String, Integer>();
    private Map<String, Integer> ownerCounts = new LinkedHashMap<String, Integer>();
    private Map<String, Integer> statusCounts = new LinkedHashMap<String, Integer>();
}
