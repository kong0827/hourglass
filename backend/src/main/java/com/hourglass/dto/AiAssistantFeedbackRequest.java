package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;

/**
 * 回答反馈：只记录评价与回答类型，不记录用户原话或回答正文。
 */
@Data
public class AiAssistantFeedbackRequest {

    /** 1 有用，0 没用 */
    @NotNull(message = "缺少评价")
    @Min(value = 0, message = "评价不合法")
    @Max(value = 1, message = "评价不合法")
    private Integer helpful;

    @Size(max = 32, message = "意图不合法")
    private String intent;

    @Size(max = 32, message = "查询类型不合法")
    private String queryType;
}
