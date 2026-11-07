package com.hourglass.dto;

/** 「我的任务」覆盖到的空间（按筛选后的全量任务统计，不受分页影响） */
public class MyTaskWorkspace {

    private String id;
    private String name;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
