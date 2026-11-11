package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;

import java.time.LocalDate;

/**
 * 任务详情里的依赖视图：在依赖边之外带出两端任务的摘要，
 * 让抽屉不必为每条依赖再查一次任务，也不必依赖甘特图的全量数据。
 */
@Data
public class TaskDependencyView {

    private String id;
    /** FS / SS / FF / SF */
    private String depType;
    private Integer lagDays;
    private TaskRef from;
    private TaskRef to;
    /** 两端项目都具备写权限时才允许在详情里改这条依赖 */
    private boolean editable;

    @Data
    public static class TaskRef {
        private String id;
        private String title;
        private String reqId;
        private String boardColumn;
        private String itemType;
        private LocalDate startDate;
        private LocalDate dueDate;
        private boolean milestone;
    }

    public static TaskRef ref(Task task) {
        TaskRef ref = new TaskRef();
        ref.setId(task.getId());
        ref.setTitle(task.getTitle());
        ref.setReqId(task.getReqId());
        ref.setBoardColumn(task.getBoardColumn());
        ref.setItemType(task.getItemType());
        ref.setStartDate(task.getStartDate());
        ref.setDueDate(task.getDueDate());
        ref.setMilestone(Boolean.TRUE.equals(task.getIsMilestone()));
        return ref;
    }
}
