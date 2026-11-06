package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;

/** 恢复到指定历史版本 */
@Data
public class ReqDocRestoreRequest {

    @NotBlank(message = "请选择要恢复的历史版本")
    private String historyId;
}
