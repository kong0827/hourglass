package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 助手启动信息：只下发当前空间里可见且可写的项目 */
@Data
public class AiAssistantBootstrapView {

    private boolean aiReady;
    private String aiStatus;
    /** 实际来源：team / workspace / personal / none */
    private String aiSource;
    /** 来源展示名：团队 AI / 本空间 AI / 我的 API Key */
    private String aiSourceName;
    /** 当前账号是否至少有一个可写项目；viewer / 无授权成员为 false */
    private boolean canCreate;
    private String role;
    private List<AiAssistantProject> projects = new ArrayList<AiAssistantProject>();
    private List<String> suggestions = new ArrayList<String>();
    private String privacyNotice;
}
