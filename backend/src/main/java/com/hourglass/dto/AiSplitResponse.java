package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * AI 拆分需求的产出：一批**任务草稿**。
 * 刻意不直接落库 —— 模型拆错了要能改能删，不能污染看板。
 */
@Data
public class AiSplitResponse {

    private String reqDocId;
    private String reqDocTitle;
    /** 正文长度（字数），用于在界面提示"这次喂了多少字" */
    private int docChars;
    private List<DraftTask> tasks = new ArrayList<DraftTask>();
    private AiUsage usage;

    @Data
    public static class DraftTask {
        private String title;
        private String description;
        /** P0-P3，后端已做合法值兜底 */
        private String priority;
        /** 依赖的草稿下标（-1 表示无依赖），前端用于排序/提示 */
        private int dependsOnIndex = -1;
        /** 模型给出的拆分理由，界面上折叠展示，方便判断拆得对不对 */
        private String reason;
        /** 默认勾选（前端可改） */
        private boolean selected = true;
    }
}
