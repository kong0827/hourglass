package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class WorkspaceCreateRequest {

    @NotBlank(message = "请填写空间名称")
    @Size(max = 20, message = "空间名称不能超过 20 字")
    private String name;
}
