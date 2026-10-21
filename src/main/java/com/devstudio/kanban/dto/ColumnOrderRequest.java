package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import java.util.List;

@Data
public class ColumnOrderRequest {

    @NotEmpty(message = "排序列表不能为空")
    private List<String> ids;
}
