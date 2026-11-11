package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiCaseApplyRequest;
import com.hourglass.dto.AiCaseDraft;
import com.hourglass.dto.AiCaseStep;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiTestCaseRequest;
import com.hourglass.dto.AiTestCaseResponse;
import com.hourglass.dto.AiUsage;
import com.hourglass.dto.TestCaseSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.TestCaseMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * AI 辅助测试：从需求文档 / 需求池条目生成测试用例草稿。
 *
 * <p>沿用文档 AI 的三条原则：
 * <ol>
 *   <li>模型只负责理解需求、拆分验证点并写步骤；去重、条数上限、字段长度全部由服务端收口。</li>
 *   <li>生成结果不落库，用户勾选确认后才创建正式用例。</li>
 *   <li>只用调用者自己的 AI 额度。</li>
 * </ol>
 */
@Service
public class AiTestCaseService {

    private static final int MAX_SOURCE_CHARS = 12000;
    private static final int MIN_CASES = 3;
    private static final int MAX_CASES = 12;
    private static final int MAX_STEPS = 12;

    private final RequirementDocService docService;
    private final DemandService demandService;
    private final TestCaseService caseService;
    private final TestCaseMapper caseMapper;
    private final AiConfigService configService;
    private final AiClient client;
    private final ObjectMapper om = new ObjectMapper();

    public AiTestCaseService(RequirementDocService docService, DemandService demandService,
                             TestCaseService caseService, TestCaseMapper caseMapper,
                             AiConfigService configService, AiClient client) {
        this.docService = docService;
        this.demandService = demandService;
        this.caseService = caseService;
        this.caseMapper = caseMapper;
        this.configService = configService;
        this.client = client;
    }

    public AiTestCaseResponse generate(String userId, String workspaceId, AiTestCaseRequest req) {
        AiConfig cfg = configService.resolve(userId);
        Source source = resolveSource(userId, workspaceId, req);
        if (source.text.trim().isEmpty()) {
            throw AppException.badRequest("来源内容还是空的，先补充需求描述再生成");
        }

        boolean truncated = source.text.length() > MAX_SOURCE_CHARS;
        String body = truncated ? source.text.substring(0, MAX_SOURCE_CHARS) : source.text;
        int cap = req.getMaxCases() == null ? 8 : Math.max(MIN_CASES, Math.min(req.getMaxCases(), MAX_CASES));

        Set<String> existingTitles = new HashSet<String>();
        for (String title : caseMapper.selectTitlesByReq(workspaceId, source.reqId)) {
            if (title != null) {
                existingTitles.add(title.trim().toLowerCase(Locale.ROOT));
            }
        }
        List<String> modules = caseMapper.selectModules(workspaceId, source.reqId);

        String system = "你是资深测试工程师，负责把一份中文需求转成可执行的测试用例。\n"
                + "硬性要求：\n"
                + "1. 只覆盖需求里明确写了的行为，绝不臆造需求没提到的功能。需求没写清的边界不要当成确定结论。\n"
                + "2. 每条用例只验证一个行为；标题写清「场景 + 对象 + 预期」，不超过 60 字，同一项目内不要重复。\n"
                + "3. 步骤 2~8 条，action 写具体操作（带关键输入/数据），expected 写可观察的结果；两者一一对应。\n"
                + "4. 需求里有约束、异常分支、权限或边界条件时，补相应的负向/边界用例；没有就不编。\n"
                + "5. priority：P0 阻塞主流程，P1 核心功能，P2 常规，P3 边缘场景。\n"
                + "6. module 优先复用给定模块名；没有合适的再给一个不超过 10 字的短模块名。\n"
                + "7. precondition 写执行前必须满足的条件；不需要就留空字符串。\n"
                + "8. reason 用一句话指出这条用例对应来源里的哪条要求，便于人工核对。\n"
                + "9. 生成 " + MIN_CASES + "~" + cap + " 条，宁少勿滥；已有用例已经覆盖的行为不要重复生成。\n"
                + "只输出 JSON，不要任何解释文字。";

        StringBuilder u = new StringBuilder();
        u.append("需求标题：").append(source.title).append("\n");
        if (truncated) {
            u.append("（内容过长，以下只保留了前 ").append(MAX_SOURCE_CHARS).append(" 字）\n");
        }
        u.append("\n需求内容：\n---\n").append(body).append("\n---\n");
        if (!modules.isEmpty()) {
            u.append("\n项目里已有的测试模块（优先复用）：").append(String.join("、", modules)).append("\n");
        }
        if (!existingTitles.isEmpty()) {
            u.append("\n项目里已有的用例标题（不要重复生成）：\n");
            int n = 0;
            for (String title : existingTitles) {
                u.append("- ").append(title).append("\n");
                if (++n >= 20) {
                    break;
                }
            }
        }
        u.append("\n请输出 JSON：{\"cases\":[{\"title\":\"\",\"precondition\":\"\",\"module\":\"\","
                + "\"priority\":\"P2\",\"reason\":\"\",\"steps\":[{\"action\":\"\",\"expected\":\"\"}]}]}");

        AiClient.Reply reply = client.chat(cfg, system, u.toString(), true);
        JsonNode root = AiClient.extractJson(om, reply.content);

        AiTestCaseResponse res = new AiTestCaseResponse();
        res.setReqId(source.reqId);
        res.setSource(req.getSource());
        res.setSourceId(req.getSourceId());
        res.setSourceTitle(source.title);
        res.setSourceChars(source.text.length());
        res.setTruncated(truncated);
        res.setUsage(AiUsage.of(reply));

        JsonNode arr = root.path("cases");
        if (!arr.isArray()) {
            throw new AppException(502, "AI 返回的结构里没有 cases 数组，请重试");
        }
        Set<String> generated = new HashSet<String>();
        for (JsonNode n : arr) {
            if (res.getCases().size() >= cap) {
                break;
            }
            AiCaseDraft draft = parseDraft(n);
            if (draft == null) {
                continue;
            }
            String key = draft.getTitle().toLowerCase(Locale.ROOT);
            if (existingTitles.contains(key) || !generated.add(key)) {
                continue;
            }
            res.getCases().add(draft);
        }
        if (res.getCases().isEmpty()) {
            throw new AppException(502, "AI 没有生成可用的用例，可能是来源信息太少，补充细节后再试");
        }
        return res;
    }

    /** 勾选的草稿逐条创建：单条失败不影响其余，同名用例跳过 */
    public AiApplyResult applyCases(String userId, String workspaceId, AiCaseApplyRequest req) {
        if (req.getCases() == null || req.getCases().isEmpty()) {
            throw AppException.badRequest("没有选中的用例");
        }
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        Set<String> titles = new HashSet<String>();
        for (String title : caseMapper.selectTitlesByReq(workspaceId, reqId)) {
            if (title != null) {
                titles.add(title.trim().toLowerCase(Locale.ROOT));
            }
        }

        AiApplyResult out = new AiApplyResult();
        for (AiCaseDraft d : req.getCases()) {
            String title = trim(d.getTitle(), 100);
            if (title.isEmpty()) {
                out.getFailed().add(new AiApplyResult.Item("（未命名）", "用例标题为空"));
                continue;
            }
            if (!titles.add(title.toLowerCase(Locale.ROOT))) {
                out.setSkipped(out.getSkipped() + 1);
                continue;
            }
            try {
                caseService.create(userId, workspaceId, toSaveRequest(reqId, req.getDemandId(), d, title));
                out.setCreated(out.getCreated() + 1);
            } catch (Exception e) {
                out.getFailed().add(new AiApplyResult.Item(title, e.getMessage()));
            }
        }
        return out;
    }

    private TestCaseSaveRequest toSaveRequest(String reqId, String demandId, AiCaseDraft d, String title) {
        TestCaseSaveRequest save = new TestCaseSaveRequest();
        save.setReqId(reqId);
        save.setDemandId(Texts.trimToNull(demandId));
        save.setTitle(title);
        save.setPrecondition(trim(d.getPrecondition(), 1000));
        save.setModule(trim(d.getModule(), 50));
        save.setPriority(AiReqDocService.normalizePriority(d.getPriority()));
        List<TestCaseSaveRequest.StepItem> steps = new ArrayList<TestCaseSaveRequest.StepItem>();
        if (d.getSteps() != null) {
            for (AiCaseStep s : d.getSteps()) {
                String action = trim(s.getAction(), 200);
                if (action.isEmpty()) {
                    continue;
                }
                TestCaseSaveRequest.StepItem item = new TestCaseSaveRequest.StepItem();
                item.setAction(action);
                item.setExpected(trim(s.getExpected(), 500));
                steps.add(item);
                if (steps.size() >= MAX_STEPS) {
                    break;
                }
            }
        }
        save.setSteps(steps);
        return save;
    }

    static AiCaseDraft parseDraft(JsonNode n) {
        String title = trim(n.path("title").asText(""), 100);
        if (title.isEmpty()) {
            return null;
        }
        AiCaseDraft d = new AiCaseDraft();
        d.setTitle(title);
        d.setPrecondition(trim(n.path("precondition").asText(""), 1000));
        d.setModule(trim(n.path("module").asText(""), 50));
        d.setPriority(AiReqDocService.normalizePriority(n.path("priority").asText("")));
        d.setReason(trim(n.path("reason").asText(""), 200));
        JsonNode steps = n.path("steps");
        if (steps.isArray()) {
            for (JsonNode s : steps) {
                String action = trim(s.path("action").asText(""), 200);
                if (action.isEmpty()) {
                    continue;
                }
                AiCaseStep step = new AiCaseStep();
                step.setAction(action);
                step.setExpected(trim(s.path("expected").asText(""), 500));
                d.getSteps().add(step);
                if (d.getSteps().size() >= MAX_STEPS) {
                    break;
                }
            }
        }
        /* 没有步骤的“用例”没法执行，直接丢弃，避免用户以为已经写全 */
        return d.getSteps().isEmpty() ? null : d;
    }

    private Source resolveSource(String userId, String workspaceId, AiTestCaseRequest req) {
        if ("doc".equals(req.getSource())) {
            RequirementDoc doc = docService.getVisible(workspaceId, userId, req.getSourceId());
            Source s = new Source();
            s.reqId = doc.getReqId();
            s.title = doc.getTitle();
            s.text = AiReqDocService.docText(doc);
            return s;
        }
        Demand d = demandService.getVisible(workspaceId, userId, req.getSourceId());
        Source s = new Source();
        s.reqId = d.getReqId();
        s.title = d.getTitle();
        StringBuilder sb = new StringBuilder();
        if (d.getItemKind() != null) {
            sb.append("需求类型：").append(d.getItemKind()).append("\n");
        }
        if (d.getPriority() != null) {
            sb.append("优先级：").append(d.getPriority()).append("\n");
        }
        if (d.getDescription() != null && !d.getDescription().trim().isEmpty()) {
            sb.append("\n背景与价值：\n").append(d.getDescription().trim()).append("\n");
        }
        if (d.getAcceptText() != null && !d.getAcceptText().trim().isEmpty()) {
            sb.append("\n验收标准：\n").append(d.getAcceptText().trim()).append("\n");
        }
        s.text = sb.toString();
        return s;
    }

    static String trim(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static final class Source {
        String reqId;
        String title;
        String text;
    }
}
