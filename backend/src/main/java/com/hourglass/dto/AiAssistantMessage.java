package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;

/** 助手对话中的一条消息（只允许 user / assistant，system 由服务端拼装） */
@Data
public class AiAssistantMessage {

    private String role;

    @Size(max = 2000, message = "单条消息不能超过 2000 字")
    private String content;
}
