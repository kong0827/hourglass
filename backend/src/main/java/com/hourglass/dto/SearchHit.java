package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 全局搜索的一条结果：项目 / 工作项 / 文档 / 需求 / 用例共用。 */
@Data
public class SearchHit {

    /** project/task/doc/demand/case */
    private String type;
    private String id;
    private String title;
    private String reqId;
    private String reqName;
    /** 原始状态码，由前端翻译 */
    private String status;
    /** 类型特有的补充信息：负责人、模块、文档分类等 */
    private String extra;
    /** 用例编号，仅 type=case 时有值；由服务层并入 extra 展示 */
    private Integer caseNo;
    private LocalDateTime updatedAt;
}
