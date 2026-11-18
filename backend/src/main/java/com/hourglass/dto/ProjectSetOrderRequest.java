package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import java.util.List;

/** 项目集手动排序：ids 为空间内全部项目集的新顺序（服务端整体重编号） */
@Data
public class ProjectSetOrderRequest {

    @NotEmpty(message = "排序列表不能为空")
    private List<String> ids;
}
