package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiInvestmentSummaryRequest;
import com.hourglass.dto.AiInvestmentSummaryResponse;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * AI 投入总结的三条铁律：没有数据不调模型、数字全部服务端算好、只回纯 Markdown。
 * 事实拼装按成员组织，供管理者圈几个人看一段时间的工作量与内容。
 */
class AiInvestmentServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final ManagerService managerService = mock(ManagerService.class);
    private final AiConfigService configService = mock(AiConfigService.class);
    private final AiClient client = mock(AiClient.class);
    private final AiInvestmentService service = new AiInvestmentService(managerService, configService, client);

    @Test
    void noMembersDoesNotCallModel() {
        prime(emptyData());
        AppException error = assertThrows(AppException.class,
                () -> service.summarize(USER, WS, request(null)));
        assertEquals(400, error.getCode());
        verifyNoInteractions(client);
    }

    @Test
    void zeroActualAndEstimateDoesNotCallModel() {
        Map<String, Object> data = data();
        castMap(data.get("totals")).put("actualMinutes", 0);
        castMap(data.get("totals")).put("estimateMinutes", 0);
        prime(data);
        AppException error = assertThrows(AppException.class,
                () -> service.summarize(USER, WS, request(null)));
        assertEquals(400, error.getCode(), "有成员但工时全为 0 也没有素材可写");
        verifyNoInteractions(client);
    }

    @Test
    void happyPathCleansReportAndFlowsRequestThroughBreakdown() {
        prime(data());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("```markdown\n好的，以下是团队工作总结：\n## 团队概览\n本期实际投入 8.0 小时。\n"
                        + "## Alice\n- 开发登录页\n## 风险与提示\n- 无\n```"));

        AiInvestmentSummaryRequest req = request(null);
        req.setMemberUserIds(Arrays.asList("U1", "U2"));
        AiInvestmentSummaryResponse res = service.summarize(USER, WS, req);

        /* 请求字段与每人工作项上限原样传给报表，数字不在这里重算 */
        verify(managerService).investmentMemberBreakdown(eq(WS), eq(USER),
                eq("2026-10-01"), eq("2026-12-31"), isNull(), isNull(), isNull(),
                eq(Arrays.asList("U1", "U2")), eq(20));

        assertTrue(res.getReport().startsWith("## 团队概览"), "围栏与客套开场都要被清洗掉");
        assertFalse(res.getReport().contains("```"));
        assertFalse(res.getReport().contains("好的"));
        assertEquals("2026-10-01", res.getFrom());
        assertEquals("2026-12-31", res.getTo());
        assertTrue(res.getLabel().contains("圈定 2 人"));

        assertEquals("deepseek-chat", res.getUsage().getModel());
        assertEquals(100, res.getUsage().getPromptTokens());
        assertEquals(50, res.getUsage().getCompletionTokens());
        assertEquals(150, res.getUsage().getTotalTokens());
        assertFalse(res.getUsage().isJsonMode(), "纯文本调用不走 JSON 模式");

        AiInvestmentSummaryResponse.Source src = res.getSource();
        assertEquals(2, src.getMembers());
        assertEquals(3, src.getItems());
        assertEquals(480, src.getActualMinutes());
        assertTrue(src.isTruncated());
        assertEquals(20, src.getPerMember());
        assertEquals(Arrays.asList("Alice"), src.getTruncatedNames());
        assertFalse(src.isWithNote());
        assertTrue(src.getChars() > 0);
    }

    @Test
    void factsCarryServerComputedNumbersIntoPrompt() {
        prime(data());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("## 团队概览\n略"));

        service.summarize(USER, WS, request(null));

        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
        verify(client).chat(any(AiConfig.class), anyString(), user.capture(), eq(false));
        String prompt = user.getValue();
        assertTrue(prompt.contains("实际 8.0 小时"), "合计工时由服务端折算成小时喂给模型");
        assertTrue(prompt.contains("测试窗口外 6.0 小时 / 测试窗口内 2.0 小时"));
        assertTrue(prompt.contains("Alice"));
        assertTrue(prompt.contains("登录页改版"));
        assertTrue(prompt.contains("阻塞"));
    }

    @Test
    void noteIsIncludedAndWithNoteFlagSet() {
        prime(data());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("## 团队概览\n略"));

        AiInvestmentSummaryResponse res = service.summarize(USER, WS, request("本周三人请假一天"));

        assertTrue(res.getSource().isWithNote());
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
        verify(client).chat(any(AiConfig.class), anyString(), user.capture(), eq(false));
        assertTrue(user.getValue().contains("管理者补充"));
        assertTrue(user.getValue().contains("本周三人请假一天"));
    }

    @Test
    void emptyModelReplyThrows502() {
        prime(data());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("   "));
        AppException error = assertThrows(AppException.class,
                () -> service.summarize(USER, WS, request(null)));
        assertEquals(502, error.getCode());
    }

    @Test
    void buildFactsRendersPeriodTotalsMembersItemsAndTruncation() {
        String facts = service.buildFacts(data(), null);
        assertTrue(facts.contains("周期：2026-10-01 — 2026-12-31（92 天）"));
        assertTrue(facts.contains("合计：实际 8.0 小时（测试窗口外 6.0 小时 / 测试窗口内 2.0 小时）"));
        assertTrue(facts.contains("预估 15.0 小时"));
        assertTrue(facts.contains("去重人力 2 人"));
        assertTrue(facts.contains("投入 1.0 人天"));
        assertTrue(facts.contains("1. Alice（开发 · A 公司）"));
        assertTrue(facts.contains("实际占比 75%"));
        assertTrue(facts.contains("- 登录页改版（项目甲 · 实际 6.0 小时，其中测试窗口内 1.0 小时 · 进行中 · 阻塞）"));
        assertTrue(facts.contains("…另有工作项未列出"));
        assertTrue(facts.contains("2. Bob（测试 · A 公司）"));
        assertFalse(facts.contains("管理者补充"), "没有补充说明时不追加该段");
    }

    @Test
    void buildFactsCapsLongNote() {
        StringBuilder longNote = new StringBuilder();
        for (int i = 0; i < 300; i++) {
            longNote.append("字");
        }
        String facts = service.buildFacts(data(), longNote.toString());
        assertTrue(facts.contains("管理者补充"));
        int idx = facts.indexOf("管理者补充");
        String tail = facts.substring(idx);
        int count = 0;
        for (int i = 0; i < tail.length(); i++) {
            if (tail.charAt(i) == '字') {
                count++;
            }
        }
        assertEquals(200, count, "补充说明最多喂 200 字，避免白烧 token");
    }

    // ==================== 夹具 ====================

    private void prime(Map<String, Object> data) {
        when(configService.resolve(USER, WS)).thenReturn(config());
        when(managerService.investmentMemberBreakdown(eq(WS), eq(USER),
                any(), any(), any(), any(), any(), any(), anyInt())).thenReturn(data);
    }

    private static AiInvestmentSummaryRequest request(String note) {
        AiInvestmentSummaryRequest req = new AiInvestmentSummaryRequest();
        req.setFrom("2026-10-01");
        req.setTo("2026-12-31");
        req.setNote(note);
        return req;
    }

    private static Map<String, Object> data() {
        Map<String, Object> range = new LinkedHashMap<String, Object>();
        range.put("from", "2026-10-01");
        range.put("to", "2026-12-31");
        range.put("days", 92);

        Map<String, Object> totals = new LinkedHashMap<String, Object>();
        totals.put("actualMinutes", 480);
        totals.put("devMinutes", 360);
        totals.put("testMinutes", 120);
        totals.put("estimateMinutes", 900);
        totals.put("users", 2);
        totals.put("tasks", 3);

        Map<String, Object> alice = member("u:U1", "Alice", "开发", "A 公司", 360, 300, 60, 600, 75L, 1, 2);
        alice.put("items", new ArrayList<Map<String, Object>>(Arrays.asList(
                item("T1", "登录页改版", "项目甲", "doing", true, 600, 360, 300, 60),
                item("T2", "联调", "项目甲", "todo", false, 100, 0, 0, 0))));
        alice.put("itemTruncated", Boolean.TRUE);

        Map<String, Object> bob = member("u:U2", "Bob", "测试", "A 公司", 120, 0, 120, 300, 25L, 1, 1);
        bob.put("items", new ArrayList<Map<String, Object>>(Arrays.asList(
                item("T3", "回归测试", "项目甲", "done", false, 200, 120, 0, 120))));
        bob.put("itemTruncated", Boolean.FALSE);

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("range", range);
        data.put("totals", totals);
        data.put("members", new ArrayList<Map<String, Object>>(Arrays.asList(alice, bob)));
        return data;
    }

    private static Map<String, Object> emptyData() {
        Map<String, Object> data = data();
        data.put("members", new ArrayList<Map<String, Object>>());
        castMap(data.get("totals")).put("actualMinutes", 0);
        castMap(data.get("totals")).put("estimateMinutes", 0);
        return data;
    }

    private static Map<String, Object> member(String key, String name, String role, String company,
                                              int actual, int dev, int test, int estimate, long share,
                                              int projects, int tasks) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("key", key);
        m.put("name", name);
        m.put("roleTitle", role);
        m.put("companyName", company);
        m.put("actualMinutes", actual);
        m.put("devMinutes", dev);
        m.put("testMinutes", test);
        m.put("estimateMinutes", estimate);
        m.put("sharePct", share);
        m.put("projects", projects);
        m.put("tasks", tasks);
        return m;
    }

    private static Map<String, Object> item(String id, String title, String reqName, String column, boolean blocked,
                                            int estimate, int total, int dev, int test) {
        Map<String, Object> it = new LinkedHashMap<String, Object>();
        it.put("id", id);
        it.put("title", title);
        it.put("reqName", reqName);
        it.put("boardColumn", column);
        it.put("blocked", blocked);
        it.put("estimateMinutes", estimate);
        it.put("totalMinutes", total);
        it.put("devMinutes", dev);
        it.put("testMinutes", test);
        return it;
    }

    private static AiConfig config() {
        AiConfig c = new AiConfig();
        c.setProvider("deepseek");
        c.setBaseUrl("https://api.deepseek.com/v1");
        c.setModel("deepseek-chat");
        c.setApiKey("sk-test");
        return c;
    }

    private static AiClient.Reply reply(String content) {
        AiClient.Reply r = new AiClient.Reply();
        r.content = content;
        r.model = "deepseek-chat";
        r.promptTokens = 100;
        r.completionTokens = 50;
        r.jsonModeUsed = false;
        return r;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        return (Map<String, Object>) value;
    }
}