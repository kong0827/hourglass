package com.hourglass.dto;

import com.hourglass.entity.Demand;
import lombok.Data;

/** 需求甘特行：需求基础字段 + 阶段时间轴 */
@Data
public class DemandGanttItem {

    private Demand demand;
    private DemandTimeline timeline;
}
