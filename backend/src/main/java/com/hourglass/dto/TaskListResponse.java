package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class TaskListResponse {

    private List<Task> items = new ArrayList<Task>();
    /** 筛选后总数 */
    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
}
