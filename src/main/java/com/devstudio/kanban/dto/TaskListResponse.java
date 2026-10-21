package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class TaskListResponse {

    private List<Task> items = new ArrayList<Task>();
    /** 筛选后总数（items 最多 500，超出时截断） */
    private int total;
}
