package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Size;

@Data
public class SubtaskRequest {

    @Size(max = 60, message = "子任务内容不能超过 60 字")
    private String title;

    private Boolean done;
}
