package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class TaskCommentRequest {

    @NotBlank(message = "评论内容不能为空")
    @Size(max = 500, message = "评论最多 500 字")
    private String content;
}
