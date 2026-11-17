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
    /** 需求池来源（从需求详情拆分时填写，文档来源为空） */
    private String demandId;
    private String demandTitle;
    /** 需求描述 + 验收标准的字数，口径同 docChars */
    private int demandChars;
    /** 一句话说明这次怎么拆的 / 是否覆盖验收标准，不给模型打分 */
    private String summary;
    private List<DraftTask> tasks = new ArrayList<DraftTask>();
    private AiUsage usage;

    @Data
    public static class DraftTask {
        private String title;
        private String description;
        /** P0-P3，后端已做合法值兜底 */
        private String priority;
        /** 依赖的草稿下标（-1 表示无依赖）；创建时两端都选中才会连成依赖 */
        private int dependsOnIndex = -1;
        /** 该草稿在原拆分结果里的下标（提交时回传，用于解析 dependsOnIndex；缺省按提交顺序） */
        private Integer draftIndex;
        /** 模型给出的拆分理由，界面上折叠展示，方便判断拆得对不对 */
        private String reason;
        /** 需求下已有同名工作项：默认不勾选，避免重复创建 */
        private boolean duplicate;
        /** 命中的已有工作项标题（仅 duplicate=true 时有值） */
        private String duplicateOf;
        /** 默认勾选（前端可改） */
        private boolean selected = true;
    }
}
