package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class SavedViewRequest {

    @NotBlank(message = "请填写视图名称")
    @Size(max = 20, message = "视图名称不能超过 20 字")
    private String name;

    /** 筛选参数 JSON 字符串 */
    @NotBlank(message = "视图参数不能为空")
    @Size(max = 600, message = "视图参数过长")
    private String params;
}
