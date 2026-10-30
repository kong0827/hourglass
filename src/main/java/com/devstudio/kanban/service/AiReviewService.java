package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AiClient;
import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.AiConfig;
import com.devstudio.kanban.dto.AiReviewResponse;
import com.devstudio.kanban.dto.AiUsage;
import com.devstudio.kanban.dto.ReqProgress;
import com.devstudio.kanban.dto.ReviewResponse;
import com.devstudio.kanban.entity.Task;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * AI 润色周报：把周回顾页已经算好的数据，写成一段能直接发出去的周报。
 *
 * <p>定这条链路时的三个决定（改之前先读）：
 * <ol>
 *   <li><b>数字不交给模型。</b>完成数、按期率、工时、逾期数量全部由 {@link ReviewService} 算好塞进提示词，
 *       并要求模型"只能引用、不得加总"。让模型自己数，它会把 3 条完成写成"完成多项"或直接数错。</li>
 *   <li><b>没有数据就不调模型。</b>这一周什么都没干的时候，调一次模型只会得到一段华丽空话，
 *       直接在前端告诉用户"这周没有记录"更省钱也更诚实。</li>
 *   <li><b>只输出纯文本 Markdown。</b>周报的终点是粘进 IM / 邮件，HTML 粘过去全是标签；
 *       也不用 JSON —— 正文本来就是给人看的，多包一层壳只会让模型多一次出错机会。</li>
 * </ol>
 */
@Service
public class AiReviewService {

    /** 喂给模型的已完成任务条数上限：再多也写不进周报，白白烧 token */
    private static final int MAX_DONE_ITEMS = 30;
    private static final int MAX_PROGRESS_ITEMS = 15;
    private static final int MAX_NOTE_CHARS = 200;
    private static final DateTimeFormatter MD = DateTimeFormatter.ofPattern("MM-dd");

    private final ReviewService reviewService;
    private final AiConfigService configService;
    private final AiClient client;

    public AiReviewService(ReviewService reviewService, AiConfigService configService, AiClient client) {
        this.reviewService = reviewService;
        this.configService = configService;
        this.client = client;
    }

    public AiReviewResponse polish(String userId, String workspaceId, Integer weekOffset, String note) {
        AiConfig cfg = configService.resolve(userId);
        int off = weekOffset == null ? 0 : Math.max(-52, Math.min(0, weekOffset));
        ReviewResponse d = reviewService.review(workspaceId, userId, off);

        List<Task> done = d.getCompleted();
        List<Task> progress = d.getProgressTasks();
        List<Task> pending = d.getPendingDone();
        int doing = d.getDoing();
        int backlog = d.getBacklog();
        if (done.isEmpty() && progress.isEmpty() && pending.isEmpty() && doing == 0 && backlog == 0) {
            throw AppException.badRequest("这一周没有任何工作记录，没有素材可写。先把卡片拖进「已完成」或用进度记录一下这周做了什么。");
        }

        AiReviewResponse.Source src = new AiReviewResponse.Source();
        src.setCompleted(done.size());
        src.setProgress(progress.size());
        src.setPendingDone(pending.size());
        src.setWithNote(note != null && !note.trim().isEmpty());

        String facts = buildFacts(d, note);
        src.setChars(facts.length());
        src.setTruncated(done.size() > MAX_DONE_ITEMS || progress.size() > MAX_PROGRESS_ITEMS);

        String system = "你是资深研发工程师的周报代笔，把给定的工作记录写成一份可以直接发出去的周报。\n"
                + "硬性要求：\n"
                + "1. 只能用给定事实。任务名照抄原意可以缩写，但绝不编造任务、成果、数字或人名；事实里没有的一律不写。\n"
                + "2. 所有数字必须与给定统计一致。不要自行加总、不要估算、不要写\"约\"\"左右\"。\n"
                + "3. 以第一人称「我」叙述；出现他人时用给定的人名。不要出现\"AI\"\"本工具\"\"根据数据\"这类字样，"
                + "也不要写\"在此总结\"之类的客套开场。\n"
                + "4. 只输出纯 Markdown 文本，不要 ``` 围栏，固定四个二级标题，顺序不变：\n"
                + "## 本周完成\n## 进行中\n## 风险与阻塞\n## 下周计划\n"
                + "5. 每节用「- 」列表：一条一行，不超过 45 字，动词开头并带上对象与结果"
                + "（好例：\"重构权限校验中间件，四个入口统一走鉴权\"）。某节确实没有内容就写\"- 无\"，不要删掉标题。\n"
                + "6. 「本周完成」只写已完成的；「进行中」写进度与卡点；「风险与阻塞」写逾期、未关闭的 P0、"
                + "以及进度 100% 却还没入完成列的任务；「下周计划」只能从进行中、待处理、风险里推，不要发明新方向。\n"
                + "7. 全文控制在 400 字以内，宁短勿长。";

        StringBuilder u = new StringBuilder();
        u.append("以下是系统统计出来的工作记录，只作为事实来源：\n\n");
        u.append(facts);
        u.append("\n请据此写成周报。");

        AiClient.Reply reply = client.chat(cfg, system, u.toString(), false);

        AiReviewResponse res = new AiReviewResponse();
        res.setWeekOffset(d.getWeekOffset());
        res.setLabel(d.getLabel());
        res.setWeekStart(d.getWeekStart());
        res.setWeekEnd(d.getWeekEnd());
        res.setReport(clean(reply.content));
        res.setSource(src);
        res.setUsage(AiUsage.of(reply.model, reply.promptTokens, reply.completionTokens, reply.jsonModeUsed));
        if (res.getReport().isEmpty()) {
            throw new IllegalStateException("AI 返回了空内容，请重试一次");
        }
        return res;
    }

    // ==================== 事实拼装 ====================

    /**
     * 把回顾数据压成"人能读、模型不费劲"的事实块。
     * 刻意不用 JSON：模型读到 JSON 容易开始"补字段"，读到清单更老实。
     */
    String buildFacts(ReviewResponse d, String note) {
        StringBuilder sb = new StringBuilder();
        String range = fmt(d.getWeekStart()) + " — " + fmt(d.getWeekEnd());
        sb.append("周期：").append(nz(d.getLabel())).append("（").append(range).append("）\n");

        ReviewResponse.Stats s = d.getStats() == null ? new ReviewResponse.Stats() : d.getStats();
        sb.append("统计：完成 ").append(s.getDone()).append(" 项");
        if (s.getWithDue() > 0) {
            sb.append("；按期率 ").append(s.getOnTimeRate()).append("%（有截止日期 ").append(s.getWithDue())
                    .append(" 项、延期 ").append(s.getLate()).append(" 项）");
        } else {
            sb.append("；完成项都没有设截止日期，不计按期率");
        }
        sb.append("；参与成员 ").append(s.getMembers()).append(" 人");
        sb.append("；当前进行中 ").append(d.getDoing()).append(" 项、待处理 ").append(d.getBacklog()).append(" 项");
        if (d.getCounts() != null) {
            sb.append("；逾期 ").append(d.getCounts().getOver()).append(" 项")
                    .append("、今日到期 ").append(d.getCounts().getToday()).append(" 项");
        }
        sb.append("；P0 未关闭 ").append(d.getOpenP0()).append(" 项\n");

        ReviewResponse.WorkMinutes w = d.getWorkMinutes();
        if (w != null && (w.getSpaceWeek() > 0 || w.getMine() > 0)) {
            sb.append("工时：本周期全空间 ").append(hours(w.getSpaceWeek()))
                    .append("；我的累计 ").append(hours(w.getMine())).append("\n");
        }

        List<Task> done = d.getCompleted();
        if (!done.isEmpty()) {
            sb.append("\n已完成（共 ").append(done.size()).append(" 项）：\n");
            for (int i = 0; i < done.size() && i < MAX_DONE_ITEMS; i++) {
                Task t = done.get(i);
                sb.append(i + 1).append(". ").append(t.getTitle())
                        .append("（").append(nz(t.getCategory())).append(" · ").append(nz(t.getOwner()));
                if (t.getCompletedAt() != null) {
                    sb.append(" · ").append(fmt(t.getCompletedAt().toString()));
                }
                /* 延期只在"有截止日期且真的晚了"时写出，模型看到才会放进风险那节 */
                if (t.getCompletedAt() != null && t.getDueDate() != null
                        && t.getCompletedAt().isAfter(t.getDueDate())) {
                    sb.append(" · 延期完成");
                }
                sb.append("）\n");
            }
            if (done.size() > MAX_DONE_ITEMS) {
                sb.append("…另有 ").append(done.size() - MAX_DONE_ITEMS).append(" 项未列出\n");
            }
        }

        List<Task> progress = d.getProgressTasks();
        if (!progress.isEmpty()) {
            sb.append("\n进行中（共 ").append(progress.size()).append(" 项）：\n");
            for (int i = 0; i < progress.size() && i < MAX_PROGRESS_ITEMS; i++) {
                Task t = progress.get(i);
                sb.append(i + 1).append(". ").append(t.getTitle())
                        .append("（进度 ").append(t.getProgress() == null ? 0 : t.getProgress()).append("%");
                if (t.getOwner() != null && !t.getOwner().isEmpty()) {
                    sb.append(" · ").append(t.getOwner());
                }
                if (t.getDueDate() != null) {
                    sb.append(" · 截止 ").append(t.getDueDate().toString());
                }
                sb.append("）\n");
            }
        }

        List<Task> pending = d.getPendingDone();
        if (!pending.isEmpty()) {
            sb.append("\n进度 100% 但还没移入已完成列（共 ").append(pending.size()).append(" 项）：\n");
            for (Task t : pending) {
                sb.append("- ").append(t.getTitle()).append("\n");
            }
        }

        List<ReqProgress> reqs = d.getReqDist();
        if (!reqs.isEmpty()) {
            sb.append("\n项目进展：\n");
            for (ReqProgress r : reqs) {
                sb.append("- ").append(nz(r.getName())).append(" ").append(r.getProgressPct())
                        .append("%（").append(r.getDoneCount()).append("/").append(r.getTaskCount()).append(" 项）\n");
            }
        }

        List<ReviewResponse.MemberStat> members = d.getMembers();
        if (members.size() > 1) {
            sb.append("\n成员交付：\n");
            for (ReviewResponse.MemberStat m : members) {
                sb.append("- ").append(nz(m.getName())).append(" ").append(m.getCount()).append(" 项\n");
            }
        }

        if (note != null && !note.trim().isEmpty()) {
            String n = note.trim();
            if (n.length() > MAX_NOTE_CHARS) {
                n = n.substring(0, MAX_NOTE_CHARS);
            }
            sb.append("\n当事人补充（任务里没记录，但确实做了，可以写进周报）：\n").append(n).append("\n");
        }
        return sb.toString();
    }

    // ==================== 工具 ====================

    /**
     * 输出清洗：去掉 ``` 围栏、去掉开场的"好的，以下是周报"、压掉多余空行。
     * 这些是模型最常见的三种越界，前端做不划算（复制按钮也要干净文本）。
     */
    static String clean(String content) {
        if (content == null) {
            return "";
        }
        String s = content.trim();
        if (s.startsWith("```")) {
            int nl = s.indexOf('\n');
            if (nl > 0) {
                s = s.substring(nl + 1);
            }
            int end = s.lastIndexOf("```");
            if (end >= 0) {
                s = s.substring(0, end);
            }
        }
        s = s.replace("\r\n", "\n").trim();
        /* 去掉"好的/以下是…"这类开场，只删第一行且不是标题时 */
        String[] lines = s.split("\n", 2);
        if (lines.length == 2 && !lines[0].trim().startsWith("#")) {
            String first = lines[0].trim();
            if (first.length() <= 40 && (first.startsWith("好的") || first.startsWith("以下是")
                    || first.startsWith("这是") || first.endsWith("：") || first.endsWith(":"))) {
                s = lines[1].trim();
            }
        }
        return s.replaceAll("\n{3,}", "\n\n").trim();
    }

    private static String fmt(String iso) {
        if (iso == null || iso.isEmpty()) {
            return "";
        }
        try {
            return LocalDate.parse(iso).format(MD);
        } catch (Exception e) {
            return iso;
        }
    }

    /** 分钟 → "3.5 小时"（模型用量词比数字更不容易写错） */
    private static String hours(int minutes) {
        if (minutes <= 0) {
            return "0 小时";
        }
        return String.format(java.util.Locale.ROOT, "%.1f 小时", minutes / 60.0);
    }

    private static String nz(String s) {
        return s == null ? "" : s.trim();
    }
}
