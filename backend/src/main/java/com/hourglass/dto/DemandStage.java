package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 需求甘特的一个阶段区间；start/end 均为闭区间，point=true 表示单日节点 */
@Data
public class DemandStage {

    /** review/plan/design/dev/test/complete/release */
    private String stage;
    private LocalDate start;
    private LocalDate end;
    /** 尚未结束：区间截止到今天 */
    private boolean open;
    /** 单日节点（完成、发布与完成同日） */
    private boolean point;
}
