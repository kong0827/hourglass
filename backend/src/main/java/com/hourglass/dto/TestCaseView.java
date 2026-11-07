package com.hourglass.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** 用例列表行：步骤已解析为结构化数组，最近执行结果与转出缺陷一并下发。 */
@Data
public class TestCaseView {

    private String id;
    private String reqId;
    private String demandId;
    private String demandTitle;
    private String title;
    private String precondition;
    private String module;
    private String priority;
    private List<Map<String, String>> steps;
    private String latestStatus;
    private String latestNote;
    private String latestBy;
    private LocalDateTime latestAt;
    private String latestBugTaskId;
    private String latestBugTaskTitle;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /** 库内原始 JSON（仅服务端解析用，不下发） */
    @JsonIgnore
    private String stepsJson;
}
