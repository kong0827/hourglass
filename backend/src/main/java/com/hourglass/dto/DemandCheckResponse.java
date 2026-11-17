package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 需求提交前体检结果：建议项与相似需求都只提示，前端决定是否返回修改 */
@Data
public class DemandCheckResponse {

    private List<Issue> issues = new ArrayList<Issue>();
    private List<Similar> similar = new ArrayList<Similar>();

    @Data
    public static class Issue {
        /** 对应表单字段：acceptText / description / expectDate */
        private String field;
        /** warn=建议先补，info=可以更好 */
        private String level;
        private String title;
        private String detail;
    }

    @Data
    public static class Similar {
        private String id;
        private Integer demandNo;
        private String title;
        private String status;
        private String closeReason;
        private String priority;
        private String versionName;
        /** 标题关键词重合度 0-100，只用于排序与说明，不是模型置信度 */
        private int score;
    }
}
