package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class CalendarResponse {

    private int year;
    private int month;
    /** 截止日期落在该月内的任务（含已完成） */
    private List<Task> tasks = new ArrayList<Task>();
}
