package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 需求完成度体检。
 *
 * <p>分工：<b>AI 只负责"把需求拆成可验证的功能点"和"给每个点找覆盖它的任务"</b>，
 * 分数和结论由服务端按规则算 —— 让模型直接打分会给出看起来合理但没法解释的数字。
 */
@Data
public class AiAuditResponse {

    private String reqDocId;
    private String reqDocTitle;
    /** 0-100，按功能点状态加权（done=1 / doing=0.6 / todo=0.3 / missing=0） */
    private int coverage;
    /** done / mostly / partial / not_started，由覆盖率推导，不由模型决定 */
    private String verdict;
    /** 一句话结论（模型写的摘要） */
    private String summary;
    /** 建议下一步做什么（模型给，可能为空） */
    private String nextStep;

    private int totalPoints;
    private int donePoints;
    private int doingPoints;
    private int todoPoints;
    private int missingPoints;

    private List<Point> points = new ArrayList<Point>();
    /** 该需求下参与比对的全部任务，界面上让用户看到"AI 是拿这些任务判断的" */
    private List<TaskBrief> tasks = new ArrayList<TaskBrief>();
    private AiUsage usage;

    @Data
    public static class Point {
        /** 功能点：一句话，能回答"做了没" */
        private String point;
        /** 是否找到覆盖它的任务 */
        private boolean covered;
        /** done / doing / todo / missing */
        private String status;
        /** 覆盖它的任务标题（可能为空） */
        private String taskTitle;
        /** 模型的判断依据 */
        private String note;
    }

    @Data
    public static class TaskBrief {
        private String id;
        private String title;
        private String column;
        private int progress;
        private boolean done;
    }
}
