package com.hourglass.dto;

import lombok.Data;

/**
 * 全局搜索条件。q 可为空：只看范围（项目 / 版本 / 类型 / 状态 / 负责人 / 日期）时也允许。
 * 各实体只应用自己支持的维度，不支持的维度忽略。
 */
@Data
public class SearchQuery {

    private String q;
    /** project/task/doc/demand/case，空=全部 */
    private String type;
    private String reqId;
    private String versionId;
    private String status;
    /** 账号ID或显示名；项目按负责人账号/显示名，工作项/文档/用例按负责人 */
    private String owner;
    /** yyyy-MM-dd，按各实体的时间口径过滤 */
    private String from;
    private String to;
    private int limit = 8;

    public boolean hasScope() {
        return type != null || reqId != null || versionId != null || status != null
                || owner != null || from != null || to != null;
    }
}
