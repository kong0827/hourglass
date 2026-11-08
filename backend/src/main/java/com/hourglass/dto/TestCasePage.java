package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

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
}
