package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 列状态工作页的列范围参数。
 *
 * <p>与筛选条件（{@link GanttQuery}）分开：筛选条件可能为空，但「哪一列、哪个时间窗、
 * 是否包含历史列兜底」必须始终随 SQL 下推，避免两个口径各写一遍。
 */
@Data
public class WorkColumnQuery {

    private String workspaceId;
    /** 当前列 id（配置列或 done） */
    private String column;
    /** 该项目未配置的历史列是否归入首列（与看板一致） */
    private boolean fallback;
    private boolean done;
    /** true = 叠加 GanttQuery 筛选；false = 只取列范围（用于列总数） */
    private boolean filtered;
    private List<String> knownColumns = new ArrayList<String>();
    /** 明细 / 列计数的时间窗起点；null = 全部历史 */
    private LocalDate since;
    /** 指标聚合的时间窗起点；全部历史时收敛到近 90 天，避免全表扫描 */
    private LocalDate metricSince;
    private LocalDate today;
    /** 列的处理规则是否为 ended：ended 列不再按截止日期算逾期 */
    private boolean overdueEnabled;
    /** 项目可见范围：null 表示不过滤（空间主 / 管理员 / 查看者） */
    private String viewerId;
}
