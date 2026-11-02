package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDate;

/** 项目负责人/起止/优先级维护。 */
@Data
public class ProjectMetaRequest {

    @Size(max = 32, message = "项目负责人ID不合法")
    private String managerUserId;

    private LocalDate startDate;
    private LocalDate dueDate;

    @Pattern(regexp = "P0|P1|P2|P3", message = "项目优先级不合法")
    private String priority;
}
