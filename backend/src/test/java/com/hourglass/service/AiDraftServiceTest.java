package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiDraftRequest;
import com.hourglass.dto.AiDraftResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 字段级 AI 草稿：权限、去重、截断、限流与 JSON 解析 */
class AiDraftServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String PROJECT = "P1";

    private final AiConfigService configs = mock(AiConfigService.class);
    private final AiClient client = mock(AiClient.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final AiDraftService service = new AiDraftService(configs, client, access);

    @BeforeEach
    void setUp() {
        when(configs.resolve(anyString(), eq(WS))).thenReturn(mock(AiConfig.class));
    }

    private static AiClient.Reply reply(String json) {
        AiClient.Reply r = new AiClient.Reply();
        r.content = json;
        r.model = "mock-model";
        r.promptTokens = 120;
        r.completionTokens = 45;
        r.sourceLabel = "团队 AI";
        return r;
    }

    private static AiDraftRequest request(String title, String desc) {
        AiDraftRequest req = new AiDraftRequest();
        req.setProjectId(PROJECT);
        req.setTitle(title);
        req.setDescription(desc);
        return req;
    }

    @Test
    void acceptanceReturnsDraftItemsWithUsage() {
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"导出只含所选范围\",\"合计与明细一致\",\" 导出只含所选范围 \"],\"note\":\"\"}"));

        AiDraftResponse res = service.generate(USER, WS, AiDraftService.KIND_ACCEPTANCE,
                request("按项目导出对账单", "选择项目与日期范围后导出 xlsx"));

        assertEquals(Arrays.asList("导出只含所选范围", "合计与明细一致"), res.getItems());
        assertEquals("acceptance", res.getKind());
        assertEquals(165, res.getUsage().getTotalTokens());
        verify(access).assertWrite(WS, USER, PROJECT);
    }

    @Test
    void thinDescriptionIsMarkedAndPromptDiffersByKind() {
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"结果可复核\"],\"note\":\"建议补充异常场景\"}"));
        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);

        AiDraftResponse res = service.generate(USER, WS, AiDraftService.KIND_TASK_DONE,
                request("实现对账单导出接口", null));

        verify(client).chat(any(AiConfig.class), system.capture(), user.capture(), eq(true));
        assertTrue(system.getValue().contains("完成标准"));
        assertTrue(user.getValue().contains("（未填写）"));
        assertEquals("建议补充异常场景", res.getNote());
    }

    @Test
    void longDescriptionIsTruncatedBeforeSending() {
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 300; i++) {
            big.append("这一条描述用于测试截断上限是否生效。");
        }
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"结果可复核\"]}"));
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);

        service.generate(USER, WS, AiDraftService.KIND_ACCEPTANCE,
                request("标题", big.toString()));

        verify(client).chat(any(AiConfig.class), anyString(), user.capture(), eq(true));
        assertTrue(user.getValue().length() < 2400, "超长描述必须先截断再发给模型");
    }

    @Test
    void descriptionKeepsParagraphBreaks() {
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"结果可复核\"]}"));
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);

        service.generate(USER, WS, AiDraftService.KIND_ACCEPTANCE,
                request("标题", "背景：导出\n\n\n边界：只导所选\n  续行"));

        verify(client).chat(any(AiConfig.class), anyString(), user.capture(), eq(true));
        assertTrue(user.getValue().contains("背景：导出\n\n边界：只导所选\n续行"),
                "分段发过去，不要把描述压成一行");
    }

    @Test
    void existingAcceptanceIsSentWithNoRepeatInstruction() {
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"补充条目\"]}"));
        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
        AiDraftRequest req = request("标题", "描述");
        req.setExisting("1. 已有条目 A\n2. 已有条目 B");

        service.generate(USER, WS, AiDraftService.KIND_ACCEPTANCE, req);

        verify(client).chat(any(AiConfig.class), system.capture(), user.capture(), eq(true));
        assertTrue(system.getValue().contains("不要重复"));
        assertTrue(user.getValue().contains("已有验收标准（不要重复）：\n---\n1. 已有条目 A\n2. 已有条目 B\n---"));
    }

    @Test
    void invalidRequestsDoNotConsumeRateLimit() {
        String user = "U-rate-order";
        for (int i = 0; i < 25; i++) {
            assertThrows(AppException.class, () -> service.generate(user, WS,
                    AiDraftService.KIND_ACCEPTANCE, request("   ", "描述")));
        }
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"可验证\"]}"));

        AiDraftResponse res = service.generate(user, WS, AiDraftService.KIND_ACCEPTANCE,
                request("标题", "描述"));

        assertEquals(1, res.getItems().size());
        verify(client, times(1)).chat(any(AiConfig.class), anyString(), anyString(), eq(true));
    }

    @Test
    void readOnlyProjectIsRejectedBeforeCallingModel() {
        doThrow(new AppException(403, "只读"))
                .when(access).assertWrite(WS, USER, PROJECT);

        AppException e = assertThrows(AppException.class,
                () -> service.generate(USER, WS, AiDraftService.KIND_ACCEPTANCE,
                        request("按项目导出对账单", "描述")));

        assertEquals(403, e.getCode());
        verify(client, never()).chat(any(AiConfig.class), anyString(), anyString(), anyBoolean());
    }

    @Test
    void blankTitleIsRejected() {
        AppException e = assertThrows(AppException.class,
                () -> service.generate(USER, WS, AiDraftService.KIND_ACCEPTANCE, request("   ", "描述")));
        assertEquals(400, e.getCode());
    }

    @Test
    void emptyOrMalformedItemsGiveReadableError() {
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[]}"));
        assertThrows(AppException.class, () -> service.generate(USER, WS,
                AiDraftService.KIND_ACCEPTANCE, request("标题", "有描述")));

        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"summary\":\"没有 items\"}"));
        assertThrows(AppException.class, () -> service.generate(USER, WS,
                AiDraftService.KIND_ACCEPTANCE, request("标题", "有描述")));
    }

    @Test
    void perUserRateLimitStopsAtTwentyInWindow() {
        when(client.chat(any(AiConfig.class), anyString(), anyString(), eq(true)))
                .thenReturn(reply("{\"items\":[\"可验证\"]}"));
        String user = "U-rate-limit";
        for (int i = 0; i < 20; i++) {
            service.generate(user, WS, AiDraftService.KIND_ACCEPTANCE, request("标题", "描述"));
        }
        AppException e = assertThrows(AppException.class, () -> service.generate(user, WS,
                AiDraftService.KIND_ACCEPTANCE, request("标题", "描述")));
        assertEquals(429, e.getCode());
        verify(client, times(20)).chat(any(AiConfig.class), anyString(), anyString(), eq(true));
    }
}
