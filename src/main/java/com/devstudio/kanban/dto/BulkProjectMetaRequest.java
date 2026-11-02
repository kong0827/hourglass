package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 项目资料批量补全。 */
@Data
public class BulkProjectMetaRequest {

    private List<Item> items = new ArrayList<Item>();

    @Data
    public static class Item {
        private String id;
        private String managerUserId;
        private java.time.LocalDate startDate;
        private java.time.LocalDate dueDate;
        private String priority;
    }
}
