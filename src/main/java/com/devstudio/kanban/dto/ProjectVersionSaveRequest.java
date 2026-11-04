package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

@Data
public class ProjectVersionSaveRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目ID不合法")
    private String reqId;

    @NotBlank(message = "请填写版本名称")
    @Size(max = 40, message = "版本名称不能超过 40 字")
    private String name;

    @Size(max = 500, message = "版本说明不能超过 500 字")
    private String description;

    @Pattern(regexp = "planned|active", message = "版本状态不合法")
    private String status = "planned";

    private LocalDate targetDate;

    @Size(max = 500, message = "单个版本最多关联 500 个任务")
    private List<String> taskIds;
}
