package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 相似条目提示：最多 3 条，按字面相似度排序；不阻断提交 */
@Data
public class SimilarCheckResponse {

    /** demand / defect */
    private String kind;
    private List<Item> items = new ArrayList<Item>();

    @Data
    public static class Item {
        private String id;
        /** 项目内编号（DM-012 / WI-008）；null 表示存量尚未取号 */
        private Integer itemNo;
        private String title;
        /** 原始状态码：需求为 review/pass/...，缺陷为看板列 id */
        private String status;
        private String statusName;
        private String projectId;
        private String projectName;
        /** 描述纯文本摘要，便于不打开也能判断 */
        private String snippet;
        /** 0-1，仅用于排序与展示，不代表语义相同 */
        private Double score;
    }
}
