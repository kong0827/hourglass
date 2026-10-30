package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** 资源负载：按人 × 周汇总预估与实际工时（分钟） */
@Data
public class GanttLoadResponse {

    private String from;
    private String to;
    /** 每个桶的周一日期 */
    private List<LocalDate> weeks = new ArrayList<LocalDate>();
    private List<Member> members = new ArrayList<Member>();

    @Data
    public static class Member {
        private String name;
        private List<Bucket> buckets = new ArrayList<Bucket>();
    }

    @Data
    public static class Bucket {
        private LocalDate weekStart;
        private int estimateMinutes;
        private int actualMinutes;
        /** 每周容量（按 5 个工作日 × 每天上限分钟） */
        private int capacityMinutes;
    }
}
