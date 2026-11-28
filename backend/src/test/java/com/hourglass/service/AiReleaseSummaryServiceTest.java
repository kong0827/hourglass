package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiReleaseSummaryRequest;
import com.hourglass.dto.AiReleaseSummaryResponse;
import com.hourglass.dto.DeliveryNoteResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 发布摘要：事实只读、可见范围继承交付说明、Markdown 清理与限流 */
class AiReleaseSummaryServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String VERSION = "V1";

    private final DeliveryNoteService notes = mock(DeliveryNoteService.class);
    private final AiConfigService configs = mock(AiConfigService.class);
    private final AiClient client = mock(AiClient.class);
    private final AiReleaseSummaryService service = new AiReleaseSummaryService(notes, configs, client);

    @BeforeEach
    void setUp() {
        when(configs.resolve(anyString(), eq(WS))).thenReturn(mock(AiConfig.class));
    }

    private static AiClient.Reply reply(String content) {
        AiClient.Reply r = new AiClient.Reply();
        r.content = content;
        r.model = "mock-model";
        r.promptTokens = 140;
        r.completionTokens = 25;
        r.sourceLabel = "团队 AI";
        return r;
    }

    private static DeliveryNoteResponse versionNote() {
        DeliveryNoteResponse d = new DeliveryNoteResponse();
        d.setScopeType("version");
        d.setScopeId(VERSION);
        d.setScopeName("v2.3 支付网关");
        d.setVersionName("v2.3");
        d.setVersionStatus("done");
        d.setProjectName("支付网关");
        d.setTargetDate(LocalDate.of(2026, 12, 5));

        DeliveryNoteResponse.ReleaseInfo release = new DeliveryNoteResponse.ReleaseInfo();
        release.setEnvironmentName("生产");
        release.setResult("success");
        release.setExecutorName("李四");
        d.setRelease(release);

        DeliveryNoteResponse.Counts c = new DeliveryNoteResponse.Counts();
        c.setPlanned(42);
        c.setReleased(31);
        c.setPending(11);
        c.setDeferred(0);
        c.setNewCount(18);
        c.setImproveCount(6);
        c.setFixCount(5);
        c.setOtherCount(2);
        d.setCounts(c);

        DeliveryNoteResponse.Quality q = new DeliveryNoteResponse.Quality();
        q.setCaseCount(120);
        q.setExecutedCount(100);
        q.setPassRatePct(92.0);
        q.setCoveragePct(83.0);
        d.setQuality(q);

        DeliveryNoteResponse.Defects df = new DeliveryNoteResponse.Defects();
        df.setTotalCount(9);
        df.setFixedCount(7);
        df.setOpenCount(2);
        df.setBlockerOpenCount(1);
        d.setDefects(df);

        DeliveryNoteResponse.ScopeRow row = new DeliveryNoteResponse.ScopeRow();
        row.setTitle("导出对账单");
        row.setState("released");
        row.setProjectName("支付网关");
        d.setScope(Collections.singletonList(row));

        DeliveryNoteResponse.RiskRow risk = new DeliveryNoteResponse.RiskRow();
        risk.setTitle("签名回调延迟");
        risk.setImpact("支付确认变慢");
        risk.setStatus("跟踪中");
        d.setRisks(Collections.singletonList(risk));

        d.setMissing(Collections.singletonList("上线公告未记录"));
        return d;
    }

    private static AiReleaseSummaryRequest request(String type, String id) {
        AiReleaseSummaryRequest req = new AiReleaseSummaryRequest();
        req.setScopeType(type);
        req.setScopeId(id);
        return req;
    }

    @Test
    void versionSummaryUsesAggregatedFactsAndStripsFences() {
        when(notes.aggregate(WS, USER, VERSION, "R1")).thenReturn(versionNote());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("```markdown\n## 本次发布概览\n- 已上线 31 / 42 项\n```"));
        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
        AiReleaseSummaryRequest req = request("version", VERSION);
        req.setReleaseId("R1");

        AiReleaseSummaryResponse res = service.generate(USER, WS, req);

        verify(client).chat(any(AiConfig.class), system.capture(), user.capture(), eq(false));
        assertTrue(system.getValue().contains("只能使用给出的事实"));
        assertTrue(system.getValue().contains("不要代码块包裹"));
        assertTrue(user.getValue().contains("发布环境：生产"));
        assertTrue(user.getValue().contains("发布结果：成功"));
        assertTrue(user.getValue().contains("承诺工作项：42 项"));
        assertTrue(user.getValue().contains("已上线工作项：导出对账单"));
        assertTrue(user.getValue().contains("风险：签名回调延迟"));
        assertTrue(user.getValue().contains("上线公告未记录"), "缺失项要明确告诉模型不要推断");
        assertFalse(res.getMarkdown().startsWith("```"));
        assertEquals("## 本次发布概览\n- 已上线 31 / 42 项", res.getMarkdown());
        assertEquals(165, res.getUsage().getTotalTokens());
        assertTrue(res.getBasis().contains("承诺工作项：42 项"));
        assertEquals(Collections.singletonList("上线公告未记录"), res.getMissing());
    }

    @Test
    void planSummaryChaptersAndNoCrossVersionSumming() {
        DeliveryNoteResponse d = new DeliveryNoteResponse();
        d.setScopeType("plan");
        d.setScopeId("P1");
        d.setScopeName("12 月批次");
        DeliveryNoteResponse.PlanInfo plan = new DeliveryNoteResponse.PlanInfo();
        plan.setStatusName("计划中");
        plan.setOwnerName("张三");
        plan.setVersionCount(1);
        plan.setVersionNames(Collections.singletonList("v2.3"));
        plan.setTaskCount(42);
        d.setPlan(plan);
        DeliveryNoteResponse.PlanVersionChapter ch = new DeliveryNoteResponse.PlanVersionChapter();
        ch.setVersionName("v2.3");
        ch.setProjectName("支付网关");
        ch.setReleased(false);
        DeliveryNoteResponse.Counts c = new DeliveryNoteResponse.Counts();
        c.setPlanned(42);
        c.setReleased(0);
        c.setPending(42);
        ch.setCounts(c);
        d.setVersionChapters(Collections.singletonList(ch));
        when(notes.aggregatePlan(WS, USER, "P1")).thenReturn(d);
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("## 概览\n计划覆盖 1 个版本。"));
        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);

        AiReleaseSummaryResponse res = service.generate(USER, WS, request("plan", "P1"));

        verify(client).chat(any(AiConfig.class), system.capture(), user.capture(), eq(false));
        assertTrue(system.getValue().contains("不要跨版本"));
        assertTrue(user.getValue().contains("计划章节：版本「v2.3」（支付网关）：尚未确认发布"));
        assertTrue(user.getValue().contains("计划状态：计划中"));
        assertEquals("plan", res.getScopeType());
        assertEquals("发布计划「12 月批次」发布摘要", res.getTitle());
    }

    @Test
    void viewDeniedByDeliveryNoteStopsBeforeCallingModel() {
        doThrow(new AppException(403, "无权查看该版本"))
                .when(notes).aggregate(WS, USER, VERSION, "");
        AppException e = assertThrows(AppException.class,
                () -> service.generate(USER, WS, request("version", VERSION)));
        assertEquals(403, e.getCode());
        verify(client, never()).chat(any(AiConfig.class), anyString(), anyString(), anyBoolean());
    }

    @Test
    void invalidScopeIsRejectedBeforeAggregating() {
        AppException e = assertThrows(AppException.class,
                () -> service.generate(USER, WS, request("sprint", "X")));
        assertEquals(400, e.getCode());
        verify(notes, never()).aggregate(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void blankModelOutputReturnsReadableError() {
        when(notes.aggregate(WS, USER, VERSION, "")).thenReturn(versionNote());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("   "));
        AppException e = assertThrows(AppException.class,
                () -> service.generate(USER, WS, request("version", VERSION)));
        assertEquals(502, e.getCode());
    }

    @Test
    void perUserRateLimitStopsAtTenInWindow() {
        when(notes.aggregate(WS, "U-rate", VERSION, "")).thenReturn(versionNote());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply("## 概览\n已上线 31 / 42 项。"));
        for (int i = 0; i < 10; i++) {
            service.generate("U-rate", WS, request("version", VERSION));
        }
        AppException e = assertThrows(AppException.class,
                () -> service.generate("U-rate", WS, request("version", VERSION)));
        assertEquals(429, e.getCode());
    }

    @Test
    void longOutputIsCapped() {
        when(notes.aggregate(WS, USER, VERSION, "")).thenReturn(versionNote());
        char[] big = new char[7000];
        Arrays.fill(big, '长');
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(false)))
                .thenReturn(reply(new String(big)));
        AiReleaseSummaryResponse res = service.generate(USER, WS, request("version", VERSION));
        assertEquals(6000, res.getMarkdown().length());
    }
}
