package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 助手一轮回答：answer 是给人看的正文，draft 只是待确认建议 */
@Data
public class AiAssistantResponse {

    /** answer / create_task / create_demand / demand_action / move_task / clarify / navigate */
    private String intent;
    private String answer;
    private List<AiAssistantLink> links = new ArrayList<AiAssistantLink>();
    private AiAssistantDraft draft;
    /** 服务端盘点的缺失字段，绝不采用模型自报的选项 */
    private List<AiAssistantMissing> missing = new ArrayList<AiAssistantMissing>();
    private String question;
    /** 草稿确认凭据；不是前端自生成的幂等键 */
    private String requestId;
    private AiUsage usage;
    /** 命中 FAQ 或降级时没有调用模型 */
    private boolean degraded;
}
