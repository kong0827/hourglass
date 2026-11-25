package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 工时归属保存：一次提交本周网格的全部非零格子。 */
@Data
public class CatchupTimeRequest {

    private String week;
    private List<Cell> cells = new ArrayList<Cell>();

    @Data
    public static class Cell {
        /** req:<projectId> / unassigned */
        private String rowKey;
        private String day;
        private String reqId;
        private Integer minutes;
    }
}
