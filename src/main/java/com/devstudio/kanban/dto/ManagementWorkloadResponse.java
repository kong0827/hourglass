package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 按人 × 周负载。容量是“周计入上限”，实际工时是 effective minutes。 */
@Data
public class ManagementWorkloadResponse {

    private String from;
    private String to;
    private List<String> weeks = new ArrayList<String>();
    private List<Member> members = new ArrayList<Member>();

    @Data
    public static class Member {
        private String userId;
        private String name;
        private List<Week> weeks = new ArrayList<Week>();
    }

    @Data
    public static class Week {
        private String weekStart;
        private int estimateMinutes;
        private int capacityMinutes;
        private int actualMinutes;
        private int estimatedPct;
        private int estimateCoverage;
        private boolean unscheduled;
    }
}
