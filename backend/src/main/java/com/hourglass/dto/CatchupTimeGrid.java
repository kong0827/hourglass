package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 工时归属页：周一到周五 × 项目/未归属。 */
@Data
public class CatchupTimeGrid {

    private List<String> days = new ArrayList<String>();
    private List<Row> rows = new ArrayList<Row>();
    private int totalMinutes;
    private int assignedMinutes;
    private int unassignedMinutes;

    @Data
    public static class Row {
        private String key;
        private String reqId;
        private String name;
        /** project / unassigned */
        private String kind;
        private List<Integer> minutes = new ArrayList<Integer>();
    }
}
