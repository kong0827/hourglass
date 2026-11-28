package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiDraftRequest;
import com.hourglass.dto.AiDraftResponse;
import com.hourglass.dto.AiUsage;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 字段级 AI 草稿：需求「验收标准」与工作项「完成标准」。
 *
 * <p>只把当前表单里的标题与描述发给模型，结果只回给表单：不落库、不自动保存，
 * 是否采用、怎么改都由用户决定。权限、限流、长度截断在服务端做，不信任前端。
 */
@Service
public class AiDraftService {

    public static final String KIND_ACCEPTANCE = "acceptance";
    public static final String KIND_TASK_DONE = "task_done";

    private static final int MAX_TITLE = 100;
    private static final int MAX_DESC = 2000;
    private static final int MAX_ITEMS = 8;
    private static final int MAX_ITEM_CHARS = 80;
    /** 字段级生成很轻但按次计费：单人 10 分钟内最多 20 次 */
    private static final long RATE_WINDOW_MS = 10L * 60L * 1000L;
    private static final int RATE_LIMIT = 20;
    private static final Map<String, long[]> RATE = new ConcurrentHashMap<String, long[]>();

    private final AiConfigService configService;
    private final AiClient client;
    private final ProjectAccessService projectAccess;
    private final ObjectMapper om = new ObjectMapper();

    public AiDraftService(AiConfigService configService, AiClient client, ProjectAccessService projectAccess) {
        this.configService = configService;
        this.client = client;
        this.projectAccess = projectAccess;
    }

    public AiDraftResponse generate(String userId, String workspaceId, String kind, AiDraftRequest req) {
        boolean acceptance = KIND_ACCEPTANCE.equals(kind);
        if (!acceptance && !KIND_TASK_DONE.equals(kind)) {
            throw AppException.badRequest("不支持的生成类型");
        }
        if (req == null) {
            throw AppException.badRequest("缺少生成内容");
        }
        String projectId = trim(req.getProjectId(), 32);
        if (projectId.isEmpty()) {
            throw AppException.badRequest("先选择所属项目再生成");
        }
        /* 只读成员可以看需求，但生成草稿是为了写进表单，按写权限拦 */
        projectAccess.assertWrite(workspaceId, userId, projectId);

        String title = trim(req.getTitle(), MAX_TITLE);
        if (title.isEmpty()) {
            throw AppException.badRequest("先填写标题再生成");
        }
        String desc = block(req.getDescription(), MAX_DESC);
        String existing = block(req.getExisting(), MAX_DESC);
        AiConfig cfg = configService.resolve(userId, workspaceId);

        /* 校验与配置解析都可能失败；只有真正要调模型了才占限流额度 */
        rateLimit(userId);
        AiClient.Reply reply = client.chat(cfg, acceptance ? acceptancePrompt() : taskDonePrompt(),
                acceptance ? acceptanceUser(title, desc, existing) : taskDoneUser(title, desc), true);
        JsonNode root = AiClient.extractJson(om, reply.content);

        AiDraftResponse res = new AiDraftResponse();
        res.setKind(kind);
        res.setItems(readItems(root.path("items")));
        res.setNote(trim(root.path("note").asText(""), 160));
        res.setUsage(AiUsage.of(reply));
        return res;
    }

    private static String acceptancePrompt() {
        return "你是资深产品经理，负责为一条需求补充可验证的验收标准。\n"
                + "硬性要求：\n"
                + "1. 只依据给出的标题与描述，绝不补充没有提到的功能。\n"
                + "2. 输出 3–6 条，每条一句话、不超过 40 字，必须能判断\"通过/不通过\"；"
                + "禁止\"体验良好\"\"性能优秀\"这类主观描述。\n"
                + "3. 优先覆盖主流程，再覆盖能从描述推出的边界、异常、权限或数据一致性；描述没提到的不要臆造。\n"
                + "4. 若信息不足以写出可靠标准，items 给出能从标题直接推出的少量通用标准，"
                + "并在 note 里用一句话说明还需要补充什么信息。\n"
                + "5. 若给出了已有验收标准，只补充缺失部分，不要重复或改写已有条目。\n"
                + "只输出 JSON，不要任何解释文字。";
    }

    private static String taskDonePrompt() {
        return "你是资深研发负责人，负责为一个工作项补充可勾选核对的完成标准。\n"
                + "硬性要求：\n"
                + "1. 只依据给出的标题与描述，不扩展没有提到的功能。\n"
                + "2. 输出 3–5 条，每条一句话、不超过 40 字，用\"做了什么、结果是什么\"的结果描述；"
                + "禁止\"优化\"\"完善\"\"处理\"这类没有信息量的写法。\n"
                + "3. 覆盖功能完成、异常处理与验证方式；能从描述推出才写，不要臆造。\n"
                + "4. 信息不足时给保守条目，并在 note 里用一句话说明还需要补充什么。\n"
                + "只输出 JSON，不要任何解释文字。";
    }

    private static String acceptanceUser(String title, String desc, String existing) {
        StringBuilder sb = new StringBuilder();
        sb.append("需求标题：").append(title).append("\n")
                .append("需求描述：\n---\n").append(desc.isEmpty() ? "（未填写）" : desc).append("\n---\n");
        if (!existing.isEmpty()) {
            sb.append("已有验收标准（不要重复）：\n---\n").append(existing).append("\n---\n");
        }
        return sb.append("请输出 JSON：{\"items\":[\"\"],\"note\":\"\"}").toString();
    }

    private static String taskDoneUser(String title, String desc) {
        return "工作项标题：" + title + "\n"
                + "工作项描述：\n---\n" + (desc.isEmpty() ? "（未填写）" : desc) + "\n---\n"
                + "请输出 JSON：{\"items\":[\"\"],\"note\":\"\"}";
    }

    private static List<String> readItems(JsonNode arr) {
        if (!arr.isArray()) {
            throw new AppException(502, "AI 返回的结构里没有 items 数组，请重试");
        }
        List<String> items = new ArrayList<String>();
        Set<String> seen = new HashSet<String>();
        for (JsonNode n : arr) {
            String text = trim(n.asText(""), MAX_ITEM_CHARS);
            if (!text.isEmpty() && seen.add(text.toLowerCase(Locale.ROOT))) {
                items.add(text);
            }
            if (items.size() >= MAX_ITEMS) {
                break;
            }
        }
        if (items.isEmpty()) {
            throw new AppException(502, "AI 没有生成可用的条目，补充描述后再试");
        }
        return items;
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

    private static String trim(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    /** 描述保留分段：整段压成一行会丢掉「背景 / 边界」的结构，模型更容易写偏 */
    private static String block(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("[\\t\\x0B\\f\\r]+", " ")
                .replaceAll(" *\\n *", "\n")
                .replaceAll("\\n{3,}", "\n\n")
                .trim();
        return t.length() > max ? t.substring(0, max) : t;
    }
}
