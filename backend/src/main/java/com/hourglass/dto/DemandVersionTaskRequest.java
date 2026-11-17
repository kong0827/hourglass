package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Size;
import java.util.List;

/** 需求排期后把名下工作项批量带入目标版本：只能写入需求当前目标版本，已关联项跳过。 */
@Data
public class DemandVersionTaskRequest {

    @NotBlank(message = "请指定目标版本")
    @Size(max = 32, message = "目标版本ID不合法")
    private String versionId;

    @NotEmpty(message = "请选择要加入版本的工作项")
    @Size(max = 500, message = "单个版本最多关联 500 个工作项")
    private List<String> taskIds;
}
