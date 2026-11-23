package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 补记页一次返回：会话、草稿、工时归属、风险与周回顾预览。 */
@Data
public class CatchupView {

    private String weekStart;
    private String weekEnd;
    private Map<String, Object> session = new LinkedHashMap<String, Object>();
    private List<CatchupDraft> drafts = new ArrayList<CatchupDraft>();
    private CatchupTimeGrid time = new CatchupTimeGrid();
    private List<CatchupRisk> risks = new ArrayList<CatchupRisk>();
    private boolean noOtherRisk;
    private Map<String, Object> counts = new LinkedHashMap<String, Object>();
    private Map<String, Object> activity = new LinkedHashMap<String, Object>();
    private Map<String, Object> review = new LinkedHashMap<String, Object>();
}
