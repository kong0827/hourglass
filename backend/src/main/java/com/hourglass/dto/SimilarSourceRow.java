package com.hourglass.dto;

import lombok.Data;

/** 相似度候选行：只取比对需要的列，描述截到 400 字，避免整表正文进内存 */
@Data
public class SimilarSourceRow {

    private String id;
    private Integer itemNo;
    private String title;
    private String description;
    private String projectId;
    private String projectName;
    private String status;
    private String statusName;
}
