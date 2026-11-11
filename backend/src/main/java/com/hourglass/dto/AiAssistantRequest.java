package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.Size;
import java.util.ArrayList;
import java.util.List;

/** 一轮助手对话；历史截断、角色与长度由服务端再次校验 */
@Data
public class AiAssistantRequest {

    @Valid
    @Size(max = 8, message = "一次最多携带 8 条对话")
    private List<AiAssistantMessage> messages = new ArrayList<AiAssistantMessage>();

    private AiAssistantContext context;

    /** 上一轮草稿，仅用于让模型继续补字段；确认创建时不使用这个字段 */
    private AiAssistantDraft draft;
}
