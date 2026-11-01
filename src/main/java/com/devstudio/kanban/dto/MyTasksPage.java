package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.Task;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 跨空间「我的任务」一页结果：本页条目 + 全量计数（分页不影响 total） */
public class MyTasksPage {

    private final List<Task> items;
    private final int total;
    private final List<MyTaskWorkspace> spaces;
    private final int nameOnly;

    public MyTasksPage(List<Task> items, int total, List<MyTaskWorkspace> spaces, int nameOnly) {
        this.items = items == null ? Collections.<Task>emptyList() : items;
        this.total = total;
        this.spaces = spaces == null ? new ArrayList<MyTaskWorkspace>() : spaces;
        this.nameOnly = nameOnly;
    }

    public List<Task> getItems() {
        return items;
    }

    public int getTotal() {
        return total;
    }

    public List<MyTaskWorkspace> getSpaces() {
        return spaces;
    }

    public int getNameOnly() {
        return nameOnly;
    }
}
