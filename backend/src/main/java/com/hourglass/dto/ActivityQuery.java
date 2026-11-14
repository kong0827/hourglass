package com.hourglass.dto;

import lombok.Data;

/** 空间活动的筛选条件：类型 + 动作 + 操作人 + 日期区间 + 关键词，全部可选。 */
@Data
public class ActivityQuery {

    /** task / demand / project / doc / branch / version / config；空或未知=全部 */
    private String type;
    /** 原始动作名，精确匹配（各来源动作名见前端 ACT_LABEL） */
    private String action;
    private String actorId;
    /** yyyy-MM-dd，含当天 */
    private String fromDate;
    /** yyyy-MM-dd，含当天 */
    private String toDate;
    /** 匹配详情、标题、项目名与操作人显示名 */
    private String keyword;
}
