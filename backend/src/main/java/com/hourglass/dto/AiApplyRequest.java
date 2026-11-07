package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 把选中的草稿批量创建成任务 */
@Data
public class AiApplyRequest {

    private List<AiSplitResponse.DraftTask> tasks;
}
