package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Size;
import java.util.List;

/** 把选中的草稿批量创建成任务 */
@Data
public class AiApplyRequest {

    @NotEmpty(message = "没有选中的任务")
    @Size(max = 15, message = "每次最多创建 15 个任务")
    private List<AiSplitResponse.DraftTask> tasks;
}
