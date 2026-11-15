package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiInvestmentSummaryRequest;
import com.hourglass.dto.AiInvestmentSummaryResponse;
import com.hourglass.dto.AiUsage;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * AI 投入工作总结：把投入结构报表已经算好的「按人归集的事实」写成一份可读的团队工作总结。
 *
 * <p>沿用 {@link AiReviewService} 的三条铁律：数字不交给模型（全部服务端算好）、没有数据不调模型、
 * 只输出纯文本 Markdown。区别是这里按「成员」组织正文，供管理者圈几个人看一段时间的工作量与内容。
 */
@Service
public class AiInvestmentService {

    /** 每个成员喂给模型的工作项上限（与原型口径一致：每人最多 20 项，超出在报告如实注明） */
    private static final int MAX_ITEMS_PER_MEMBER = 20;
    private static final int MAX_NOTE_CHARS = 200;
    /** 人天折算与报表一致：8 小时标准工作日 */
    private static final int MINUTES_PER_DAY = 480;

    private final ManagerService managerService;
    private final AiConfigService configService;
    private final AiClient client;

    public AiInvestmentService(ManagerService managerService, AiConfigService configService, AiClient client) {
        this.managerService = managerService;
        this.configService = configService;
        this.client = client;
    }

    public AiInvestmentSummaryResponse summarize(String userId, String workspaceId,
                                                 AiInvestmentSummaryRequest request) {
        AiConfig cfg = configService.resolve(userId, workspaceId);
        AiInvestmentSummaryRequest req = request == null ? new AiInvestmentSummaryRequest() : request;
        Map<String, Object> data = managerService.investmentMemberBreakdown(workspaceId, userId,
                req.getFrom(), req.getTo(), req.getReqId(), req.getRoleTitle(), req.getCompanyName(),
                req.getMemberUserIds(), MAX_ITEMS_PER_MEMBER);

        Map<String, Object> totals = asMap(data.get("totals"));
        List<Map<String, Object>> members = asList(data.get("members"));
        int actual = num(totals.get("actualMinutes"));
        int estimate = num(totals.get("estimateMinutes"));
        if (members.isEmpty() || (actual <= 0 && estimate <= 0)) {
            throw AppException.badRequest("该周期与筛选下没有投入记录，没有素材可写。先确认计时或预估已落在所选区间内。");
        }

        String facts = buildFacts(data, req.getNote());
        AiInvestmentSummaryResponse.Source src = new AiInvestmentSummaryResponse.Source();
        src.setMembers(members.size());
        src.setActualMinutes(actual);
        src.setWithNote(req.getNote() != null && !req.getNote().trim().isEmpty());
        src.setChars(facts.length());
        int items = 0;
        boolean truncated = false;
        List<String> truncatedNames = new java.util.ArrayList<String>();
        for (Map<String, Object> member : members) {
            items += asList(member.get("items")).size();
            if (Boolean.TRUE.equals(member.get("itemTruncated"))) {
                truncated = true;
                truncatedNames.add(str(member.get("name")));
            }
        }
        src.setItems(items);
        src.setTruncated(truncated);
        src.setTruncatedNames(truncatedNames);
        src.setPerMember(MAX_ITEMS_PER_MEMBER);

        String system = "你是研发团队的投入分析助理，把给定的工时统计与工作项写成一份管理者可直接使用的团队工作总结。\n"
                + "硬性要求：\n"
                + "1. 只能用给定事实。工作项名照抄原意可以缩写，但绝不编造任务、成果、数字或人名；事实里没有的一律不写。\n"
                + "2. 所有数字必须与给定统计一致。不要自行加总、不要估算、不要写\"约\"\"左右\"；工时统一用「小时」。\n"
                + "3. 客观第三人称叙述，出现成员时用给定的人名。不要出现\"AI\"\"本工具\"\"根据数据\"这类字样，也不要客套开场。\n"
                + "4. 只输出纯 Markdown 文本，不要 ``` 围栏。结构固定：先一个「## 团队概览」，"
                + "再为给定的每个成员各写一个「## 成员名」二级标题（顺序与给定一致、人名照抄），最后一个「## 风险与提示」。\n"
                + "5. 「团队概览」用 2-4 句概括本期总投入、人力与测试窗口内 / 外结构（窗口外含需求评审、设计、开发、运维等，不要写成「开发工时」）；每个成员节用「- 」列表写其主要工作内容与投入，"
                + "一条一行、不超过 50 字，动词开头并带上对象；「风险与提示」写逾期、阻塞、窗口内计时占比偏高或投入明显失衡等，确实没有就写\"- 无\"。\n"
                + "6. 预估与实际归属周期不同，不要计算或暗示「预估 − 实际」的偏差结论。\n"
                + "7. 全文控制在 600 字以内，宁短勿长。";

        StringBuilder u = new StringBuilder();
        u.append("以下是系统统计出来的投入事实，只作为事实来源：\n\n");
        u.append(facts);
        u.append("\n请据此写成团队工作总结。");

        AiClient.Reply reply = client.chat(cfg, system, u.toString(), false);

        Map<String, Object> range = asMap(data.get("range"));
        AiInvestmentSummaryResponse res = new AiInvestmentSummaryResponse();
        res.setFrom(str(range.get("from")));
        res.setTo(str(range.get("to")));
        res.setLabel(buildLabel(data, req));
        res.setReport(AiReviewService.clean(reply.content));
        res.setSource(src);
        res.setUsage(AiUsage.of(reply));
        if (res.getReport().isEmpty()) {
            throw new AppException(502, "AI 返回了空内容，请重试一次");
        }
        return res;
    }

    // ==================== 事实拼装 ====================

    @SuppressWarnings("unchecked")
    String buildFacts(Map<String, Object> data, String note) {
        Map<String, Object> range = asMap(data.get("range"));
        Map<String, Object> totals = asMap(data.get("totals"));
        List<Map<String, Object>> members = asList(data.get("members"));
        StringBuilder sb = new StringBuilder();
        sb.append("周期：").append(str(range.get("from"))).append(" — ").append(str(range.get("to")))
                .append("（").append(num(range.get("days"))).append(" 天）\n");
        sb.append("合计：实际 ").append(hours(num(totals.get("actualMinutes"))))
                .append("（测试窗口外 ").append(hours(num(totals.get("devMinutes"))))
                .append(" / 测试窗口内 ").append(hours(num(totals.get("testMinutes")))).append("）");
        sb.append("；预估 ").append(hours(num(totals.get("estimateMinutes"))));
        sb.append("；去重人力 ").append(num(totals.get("users"))).append(" 人");
        sb.append("；投入 ").append(personDays(num(totals.get("actualMinutes")))).append(" 人天");
        sb.append("；工作项 ").append(num(totals.get("tasks"))).append(" 项\n");

        sb.append("\n成员（按实际工时排序，共 ").append(members.size()).append(" 人）：\n");
        int index = 1;
        for (Map<String, Object> member : members) {
            sb.append(index++).append(". ").append(str(member.get("name")));
            String role = str(member.get("roleTitle"));
            String company = str(member.get("companyName"));
            if (!role.isEmpty() || !company.isEmpty()) {
                sb.append("（").append(role.isEmpty() ? "未设角色" : role);
                if (!company.isEmpty()) {
                    sb.append(" · ").append(company);
                }
                sb.append("）");
            }
            sb.append("：实际 ").append(hours(num(member.get("actualMinutes"))))
                    .append("（测试窗口外 ").append(hours(num(member.get("devMinutes"))))
                    .append(" / 测试窗口内 ").append(hours(num(member.get("testMinutes")))).append("）");
            sb.append("，预估 ").append(hours(num(member.get("estimateMinutes"))));
            sb.append("，实际占比 ").append(num(member.get("sharePct"))).append("%");
            sb.append("，").append(num(member.get("projects"))).append(" 个项目 / ")
                    .append(num(member.get("tasks"))).append(" 项工作\n");
            List<Map<String, Object>> items = asList(member.get("items"));
            if (!items.isEmpty()) {
                sb.append("   主要工作：\n");
                for (Map<String, Object> item : items) {
                    sb.append("   - ").append(str(item.get("title")))
                            .append("（").append(str(item.get("reqName")));
                    int itemActual = num(item.get("totalMinutes"));
                    if (itemActual > 0) {
                        sb.append(" · 实际 ").append(hours(itemActual));
                        int itemTest = num(item.get("testMinutes"));
                        if (itemTest > 0) {
                            sb.append("，其中测试窗口内 ").append(hours(itemTest));
                        }
                    } else if (num(item.get("estimateMinutes")) > 0) {
                        sb.append(" · 预估 ").append(hours(num(item.get("estimateMinutes"))));
                    }
                    sb.append(" · ").append(statusName(str(item.get("boardColumn"))));
                    if (Boolean.TRUE.equals(item.get("blocked"))) {
                        sb.append(" · 阻塞");
                    }
                    sb.append("）\n");
                }
                if (Boolean.TRUE.equals(member.get("itemTruncated"))) {
                    sb.append("   …另有工作项未列出\n");
                }
            }
        }

        if (note != null && !note.trim().isEmpty()) {
            String n = note.trim();
            if (n.length() > MAX_NOTE_CHARS) {
                n = n.substring(0, MAX_NOTE_CHARS);
            }
            sb.append("\n管理者补充（报表里没有，但确实发生，可写进总结）：\n").append(n).append("\n");
        }
        return sb.toString();
    }

    private String buildLabel(Map<String, Object> data, AiInvestmentSummaryRequest req) {
        Map<String, Object> range = asMap(data.get("range"));
        StringBuilder sb = new StringBuilder();
        sb.append(str(range.get("from"))).append(" — ").append(str(range.get("to")));
        List<String> ids = req.getMemberUserIds();
        if (ids != null && !ids.isEmpty()) {
            sb.append(" · 圈定 ").append(ids.size()).append(" 人");
        }
        return sb.toString();
    }

    // ==================== 工具 ====================

    private static String statusName(String column) {
        if ("done".equals(column)) {
            return "已完成";
        }
        if ("doing".equals(column)) {
            return "进行中";
        }
        if ("todo".equals(column) || column == null || column.isEmpty()) {
            return "待处理";
        }
        return column;
    }

    private static String hours(int minutes) {
        if (minutes <= 0) {
            return "0 小时";
        }
        return String.format(Locale.ROOT, "%.1f 小时", minutes / 60.0);
    }

    private static String personDays(int minutes) {
        return String.format(Locale.ROOT, "%.1f", minutes / (double) MINUTES_PER_DAY);
    }

    private static String str(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private static int num(Object value) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        return 0;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : new java.util.LinkedHashMap<String, Object>();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> asList(Object value) {
        return value instanceof List ? (List<Map<String, Object>>) value : new java.util.ArrayList<Map<String, Object>>();
    }
}