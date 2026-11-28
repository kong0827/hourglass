package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiReleaseSummaryRequest;
import com.hourglass.dto.AiReleaseSummaryResponse;
import com.hourglass.dto.AiUsage;
import com.hourglass.dto.DeliveryNoteResponse;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 发布说明 / 变更摘要：把交付说明里已经聚合好的系统事实交给模型写成 Markdown 草稿。
 *
 * <p>只读、不落库：事实来自 DeliveryNoteService（自带可见范围校验），模型只做措辞，
 * 不允许补数字或人名；交付说明里标注「系统无记录」的部分会明确告诉模型不要写。
 * 草稿由用户在页面上改完再复制，不自动保存，也不进入快照。
 */
@Service
public class AiReleaseSummaryService {

    private static final int MAX_MARKDOWN = 6000;
    private static final int MAX_LIST = 8;
    private static final int TITLE_CHARS = 40;
    /** 摘要比字段草稿贵：单人 10 分钟内最多 10 次 */
    private static final long RATE_WINDOW_MS = 10L * 60L * 1000L;
    private static final int RATE_LIMIT = 10;
    private static final Map<String, long[]> RATE = new ConcurrentHashMap<String, long[]>();
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final DeliveryNoteService notes;
    private final AiConfigService configService;
    private final AiClient client;

    public AiReleaseSummaryService(DeliveryNoteService notes, AiConfigService configService, AiClient client) {
        this.notes = notes;
        this.configService = configService;
        this.client = client;
    }

    public AiReleaseSummaryResponse generate(String userId, String workspaceId, AiReleaseSummaryRequest req) {
        if (req == null) {
            throw AppException.badRequest("缺少摘要参数");
        }
        String type = trim(req.getScopeType(), 16);
        boolean plan = "plan".equalsIgnoreCase(type);
        if (!plan && !"version".equalsIgnoreCase(type)) {
            throw AppException.badRequest("摘要范围只能是版本或发布计划");
        }
        String scopeId = trim(req.getScopeId(), 32);
        if (scopeId.isEmpty()) {
            throw AppException.badRequest("缺少版本或计划 ID");
        }
        /* 聚合自带可见范围校验：看不到这份交付说明，就生成不了摘要 */
        DeliveryNoteResponse note = plan
                ? notes.aggregatePlan(workspaceId, userId, scopeId)
                : notes.aggregate(workspaceId, userId, scopeId, trim(req.getReleaseId(), 32));
        AiConfig cfg = configService.resolve(userId, workspaceId);

        String facts = plan ? planFacts(note) : versionFacts(note);
        List<String> basis = splitLines(facts);
        String tone = "formal".equalsIgnoreCase(trim(req.getTone(), 12)) ? "正式" : "平实";

        rateLimit(userId);
        AiClient.Reply reply = client.chat(cfg, systemPrompt(plan), userPrompt(note, facts, tone), false);
        String markdown = cleanMarkdown(reply.content);
        if (markdown.isEmpty()) {
            throw new AppException(502, "AI 没有返回可用的摘要，请稍后重试");
        }

        AiReleaseSummaryResponse res = new AiReleaseSummaryResponse();
        res.setScopeType(plan ? "plan" : "version");
        res.setScopeId(scopeId);
        res.setScopeName(trim(note.getScopeName(), 120));
        res.setTitle((plan ? "发布计划" : "版本") + "「" + trim(note.getScopeName(), 120) + "」发布摘要");
        res.setMarkdown(markdown);
        res.setBasis(basis);
        res.setMissing(note.getMissing() == null ? new ArrayList<String>() : note.getMissing());
        res.setUsage(AiUsage.of(reply));
        res.setGeneratedAt(LocalDateTime.now());
        return res;
    }

    private static String systemPrompt(boolean plan) {
        return "你是研发交付负责人，负责把系统里已经记录好的事实整理成一份中文发布摘要草稿。\n"
                + "硬性要求：\n"
                + "1. 只能使用给出的事实：数字、日期、名称、状态一律不得改写、推算或编造；事实里没有的信息直接不写。\n"
                + "2. 输出 Markdown，只用二级标题，建议结构：## 本次发布概览 / ## 交付内容 / ## 质量与验证 / "
                + "## 已知问题与风险 / ## 后续动作。没有对应事实的章节可以省略。\n"
                + "3. 语气平实、短句；不要营销词和主观评价（如「重磅」「完美」「大幅提升」）。\n"
                + "4. 缺少的数据用「未记录」说明，不要用「约」「左右」估算。\n"
                + (plan
                    ? "5. 计划维度按版本分节列范围和结论，不要跨版本把质量或缺陷数字相加。\n"
                    : "5. 版本维度先写承诺与实际上线，再写质量、缺陷与遗留事项。\n")
                + "6. 这是内部草稿：可以写待办与风险，但不写内部玩笑，不评价具体个人。\n"
                + "7. 200–500 字；只输出 Markdown 正文，不要代码块包裹，不要额外解释。";
    }

    private static String userPrompt(DeliveryNoteResponse note, String facts, String tone) {
        StringBuilder sb = new StringBuilder();
        sb.append("文档：").append(nullToEmpty(note.getScopeName())).append("（")
                .append("plan".equals(note.getScopeType()) ? "发布计划" : "版本").append("）\n");
        sb.append("生成时间：").append(LocalDateTime.now().format(DATE_TIME)).append("\n");
        sb.append("语气：").append(tone).append("\n\n");
        sb.append("事实（全部来自系统记录，只能据此写作）：\n---\n").append(facts).append("---\n");
        List<String> missing = note.getMissing();
        if (missing != null && !missing.isEmpty()) {
            sb.append("\n系统内没有记录、不要推断的内容：\n");
            for (String m : missing) {
                sb.append("- ").append(nullToEmpty(m)).append("\n");
            }
        }
        sb.append("\n请输出发布摘要草稿。");
        return sb.toString();
    }

    /* ==================== 事实拼装 ==================== */

    private static String versionFacts(DeliveryNoteResponse d) {
        List<String> f = new ArrayList<String>();
        line(f, "范围", "版本「" + nz(d.getVersionName()) + "」（项目：" + nz(d.getProjectName()) + "）");
        line(f, "版本状态", d.getVersionStatus());
        line(f, "目标日期", date(d.getTargetDate()));
        DeliveryNoteResponse.ReleaseInfo r = d.getRelease();
        if (r != null) {
            line(f, "发布环境", r.getEnvironmentName() != null ? r.getEnvironmentName() : r.getEnvironment());
            line(f, "发布结果", resultName(r.getResult()));
            line(f, "发布时间", r.getOccurredAt() != null ? time(r.getOccurredAt()) : date(r.getPublishedOn()));
            line(f, "执行人", r.getExecutorName());
            if (r.getDelayDays() != null) {
                int delay = r.getDelayDays();
                line(f, "相对目标日期", delay > 0 ? "晚 " + delay + " 天" : delay < 0 ? "早 " + (-delay) + " 天" : "按期");
            }
            line(f, "产物", r.getArtifactRef());
        }
        DeliveryNoteResponse.Counts c = d.getCounts();
        if (c != null) {
            line(f, "承诺工作项", count(c.getPlanned()));
            line(f, "已上线", count(c.getReleased()));
            line(f, "未纳入本次", count(c.getPending()));
            line(f, "延后", count(c.getDeferred()));
            line(f, "交付性质", "新功能 " + nz(c.getNewCount()) + " 项、体验优化 " + nz(c.getImproveCount())
                    + " 项、缺陷修复 " + nz(c.getFixCount()) + " 项、其他 " + nz(c.getOtherCount()) + " 项");
        }
        DeliveryNoteResponse.DemandSummary ds = d.getDemandSummary();
        if (ds != null) {
            line(f, "需求", "共 " + nz(ds.getTotal()) + " 条，满足 " + nz(ds.getFulfilled())
                    + "、部分 " + nz(ds.getPartial()) + "、延后 " + nz(ds.getDeferred())
                    + "、未完成 " + nz(ds.getPending()) + "（完成率 " + nz(ds.getRatePct()) + "%）");
        }
        DeliveryNoteResponse.Quality q = d.getQuality();
        if (q != null) {
            line(f, "测试用例", "共 " + nz(q.getCaseCount()) + " 条，已执行 " + nz(q.getExecutedCount()) + " 条");
            line(f, "用例通过率", pct(q.getPassRatePct()));
            line(f, "用例覆盖率", pct(q.getCoveragePct()));
        }
        DeliveryNoteResponse.Defects df = d.getDefects();
        if (df != null) {
            line(f, "缺陷", "共 " + nz(df.getTotalCount()) + " 个，已修复 " + nz(df.getFixedCount())
                    + "，未关闭 " + nz(df.getOpenCount()) + "，其中阻断级未关闭 " + nz(df.getBlockerOpenCount()) + " 个");
        }
        DeliveryNoteResponse.Effort e = d.getEffort();
        if (e != null) {
            line(f, "工时", "实际 " + hours(e.getWorkMinutes()) + "，预估 " + hours(e.getEstimateMinutes())
                    + "，参与 " + nz(e.getMemberCount()) + " 人");
        }
        DeliveryNoteResponse.Acceptance acc = d.getAcceptance();
        if (acc != null) {
            line(f, "验收结论", acceptanceName(acc.getConclusionKind()) + "，阻塞项 " + nz(acc.getBlockerCount()) + " 个");
            List<String> conditions = acc.getConditions();
            if (conditions != null && !conditions.isEmpty()) {
                line(f, "验收条件", cut(String.join("；", conditions), 200));
            }
        }
        if (d.getScope() != null) {
            int added = 0;
            for (DeliveryNoteResponse.ScopeRow row : d.getScope()) {
                if (!"released".equals(row.getState())) {
                    continue;
                }
                line(f, "已上线工作项", cut(nullToEmpty(row.getTitle()), TITLE_CHARS)
                        + (row.getProjectName() == null ? "" : "（" + row.getProjectName() + "）"));
                if (++added >= MAX_LIST) {
                    break;
                }
            }
        }
        if (d.getChanges() != null && !d.getChanges().isEmpty()) {
            int n = 0;
            for (DeliveryNoteResponse.ChangeRow ch : d.getChanges()) {
                line(f, "范围变更", (ch.getDate() == null ? "" : ch.getDate() + " ")
                        + cut(nullToEmpty(ch.getTitle()), TITLE_CHARS)
                        + (ch.getActorName() == null ? "" : "（" + ch.getActorName() + "）"));
                if (++n >= MAX_LIST) {
                    break;
                }
            }
        }
        if (d.getRisks() != null && !d.getRisks().isEmpty()) {
            int n = 0;
            for (DeliveryNoteResponse.RiskRow risk : d.getRisks()) {
                line(f, "风险", cut(nullToEmpty(risk.getTitle()), TITLE_CHARS)
                        + (risk.getImpact() == null ? "" : "；影响：" + cut(risk.getImpact(), 80))
                        + (risk.getStatus() == null ? "" : "；状态：" + risk.getStatus()));
                if (++n >= MAX_LIST) {
                    break;
                }
            }
        }
        return String.join("\n", f) + "\n";
    }

    private static String planFacts(DeliveryNoteResponse d) {
        List<String> f = new ArrayList<String>();
        line(f, "范围", "发布计划「" + nz(d.getScopeName()) + "」");
        DeliveryNoteResponse.PlanInfo p = d.getPlan();
        if (p != null) {
            line(f, "计划状态", p.getStatusName() != null ? p.getStatusName() : p.getStatus());
            line(f, "负责人", p.getOwnerName());
            line(f, "计划环境", p.getEnvironmentName() != null ? p.getEnvironmentName() : p.getEnvironment());
            if (p.getTargets() != null && !p.getTargets().isEmpty()) {
                line(f, "涉及项目", String.join("、", p.getTargets()));
            }
            line(f, "覆盖版本", nz(p.getVersionCount()) + " 个：" + join(p.getVersionNames(), 12));
            line(f, "工作项", nz(p.getTaskCount()));
            line(f, "计划约定", cut(nullToEmpty(p.getRisks()), 400));
        }
        DeliveryNoteResponse.Counts c = d.getCounts();
        if (c != null) {
            line(f, "承诺工作项", count(c.getPlanned()));
            line(f, "已上线", count(c.getReleased()));
            line(f, "未纳入本次", count(c.getPending()));
            line(f, "延后", count(c.getDeferred()));
        }
        List<DeliveryNoteResponse.PlanVersionChapter> chapters = d.getVersionChapters();
        if (chapters != null) {
            int n = 0;
            for (DeliveryNoteResponse.PlanVersionChapter ch : chapters) {
                StringBuilder sb = new StringBuilder("版本「").append(nz(ch.getVersionName())).append("」");
                if (ch.getProjectName() != null) {
                    sb.append("（").append(ch.getProjectName()).append("）");
                }
                sb.append(Boolean.TRUE.equals(ch.getReleased()) ? "：已确认发布" : "：尚未确认发布");
                if (ch.getCounts() != null) {
                    sb.append("；承诺 ").append(nz(ch.getCounts().getPlanned()))
                            .append(" 项，已上线 ").append(nz(ch.getCounts().getReleased()))
                            .append(" 项，未纳入 ").append(nz(ch.getCounts().getPending())).append(" 项");
                }
                if (ch.getQuality() != null && ch.getQuality().getPassRatePct() != null) {
                    sb.append("；用例通过率 ").append(ch.getQuality().getPassRatePct().intValue()).append("%");
                }
                if (ch.getDefects() != null) {
                    sb.append("；未关闭缺陷 ").append(nz(ch.getDefects().getOpenCount()))
                            .append(" 个（阻断 ").append(nz(ch.getDefects().getBlockerOpenCount())).append(" 个）");
                }
                if (ch.getAcceptance() != null) {
                    sb.append("；验收结论 ").append(acceptanceName(ch.getAcceptance().getConclusionKind()));
                }
                line(f, "计划章节", sb.toString());
                if (++n >= 12) {
                    break;
                }
            }
        }
        if (d.getRisks() != null && !d.getRisks().isEmpty()) {
            int n = 0;
            for (DeliveryNoteResponse.RiskRow risk : d.getRisks()) {
                line(f, "风险", cut(nullToEmpty(risk.getTitle()), TITLE_CHARS)
                        + (risk.getImpact() == null ? "" : "；影响：" + cut(risk.getImpact(), 80))
                        + (risk.getStatus() == null ? "" : "；状态：" + risk.getStatus()));
                if (++n >= MAX_LIST) {
                    break;
                }
            }
        }
        return String.join("\n", f) + "\n";
    }

    /* ==================== 小工具 ==================== */

    private static void line(List<String> out, String label, String value) {
        String v = value == null ? "" : value.trim();
        if (!v.isEmpty()) {
            out.add(label + "：" + v);
        }
    }

    private static List<String> splitLines(String facts) {
        List<String> out = new ArrayList<String>();
        for (String s : facts.split("\n")) {
            if (!s.trim().isEmpty()) {
                out.add(s.trim());
            }
        }
        return out;
    }

    private static String cleanMarkdown(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.startsWith("```")) {
            int firstBreak = s.indexOf('\n');
            if (firstBreak > 0) {
                s = s.substring(firstBreak + 1);
            }
            if (s.endsWith("```")) {
                s = s.substring(0, s.length() - 3);
            }
            s = s.trim();
        }
        return s.length() > MAX_MARKDOWN ? s.substring(0, MAX_MARKDOWN) : s;
    }

    private static String count(Integer n) {
        return n == null ? "未记录" : n + " 项";
    }

    private static String hours(Integer minutes) {
        if (minutes == null) {
            return "未记录";
        }
        if (minutes < 60) {
            return minutes + " 分钟";
        }
        return String.format(java.util.Locale.ROOT, "%.1f 小时", minutes / 60.0);
    }

    private static String pct(Double v) {
        return v == null ? "未记录" : String.format(java.util.Locale.ROOT, "%.0f%%", v);
    }

    private static String resultName(String result) {
        if (result == null) {
            return null;
        }
        if ("success".equals(result)) {
            return "成功";
        }
        if ("failed".equals(result)) {
            return "失败";
        }
        return result;
    }

    private static String acceptanceName(String kind) {
        if ("verified".equals(kind)) {
            return "已验证";
        }
        if ("partial".equals(kind)) {
            return "部分验证";
        }
        if ("unverified".equals(kind)) {
            return "未验证";
        }
        return "未记录";
    }

    private static String date(LocalDate d) {
        return d == null ? null : d.toString();
    }

    private static String time(LocalDateTime t) {
        return t == null ? null : t.format(DATE_TIME);
    }

    private static String join(List<String> list, int max) {
        if (list == null || list.isEmpty()) {
            return "未记录";
        }
        List<String> part = list.size() > max ? list.subList(0, max) : list;
        String s = String.join("、", part);
        return list.size() > max ? s + " 等 " + list.size() + " 个" : s;
    }

    private static String nz(Integer n) {
        return n == null ? "未记录" : String.valueOf(n);
    }

    private static String nz(String s) {
        return s == null || s.trim().isEmpty() ? "未记录" : s;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String cut(String s, int max) {
        String t = s == null ? "" : s.replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max) + "…" : t;
    }

    private static String trim(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static void rateLimit(String userId) {
        long now = System.currentTimeMillis();
        synchronized (RATE) {
            long[] slot = RATE.get(userId);
            if (slot == null || now - slot[0] >= RATE_WINDOW_MS) {
                RATE.put(userId, new long[]{now, 1L});
                return;
            }
            if (slot[1] >= RATE_LIMIT) {
                throw new AppException(429, "生成太频繁了，请稍后再试");
            }
            slot[1]++;
        }
    }
}
