package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 助手一轮回答：answer 是给人看的正文，draft 只是待确认建议 */
@Data
public class AiAssistantResponse {

    /** answer / query / create_task / create_demand / demand_action / move_task / clarify / navigate */
    private String intent;
    private String answer;
    private List<AiAssistantLink> links = new ArrayList<AiAssistantLink>();
    /** intent=query 的结果：服务端按固定模板或只读工具查询，标题不进对话历史 */
    private String queryType;
    /** 当前页面上下文说明，例如「版本详情 · v2.3 · 支付网关」 */
    private String contextLabel;
    /** 引用口径：只读查询 / 帮助手册 / AI 归纳 */
    private String sourceLabel;
    /** 数据统计时间（yyyy-MM-dd HH:mm），让用户知道数字是什么时候的 */
    private String asOf;
    /** 只读工具产出的指标摘要；模型不能伪造 */
    private List<AiAssistantFact> facts = new ArrayList<AiAssistantFact>();
    private List<AiAssistantTaskItem> tasks = new ArrayList<AiAssistantTaskItem>();
    private int total;
    private boolean hasMore;
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
