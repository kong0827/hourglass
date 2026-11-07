package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
public class Requirement {

    private String id;
    private String workspaceId;
    private String name;
    private String description;
    /** active/done/hold */
    private String status;
    /** 首版上线日（sql/23）：阶段归组口径 —— 完成日 ≤ 该日的任务归首版，之后归迭代 */
    private LocalDate firstReleasedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
