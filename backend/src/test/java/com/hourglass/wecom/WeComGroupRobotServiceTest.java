package com.hourglass.wecom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComGroupRobot;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.mapper.WeComGroupRobotMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.client.RestTemplate;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeComGroupRobotServiceTest {

    private static final String OK = "{\"errcode\":0,\"errmsg\":\"ok\"}";

    private final WeComGroupRobotMapper mapper = mock(WeComGroupRobotMapper.class);
    private final WeComCorpMapper corpMapper = mock(WeComCorpMapper.class);
    private final WeComCorpService corpService = mock(WeComCorpService.class);
    private final WeComUserBindMapper bindMapper = mock(WeComUserBindMapper.class);
    private final WeComProperties props = mock(WeComProperties.class);
    private final RestTemplate rest = mock(RestTemplate.class);
    private final ObjectMapper json = new ObjectMapper();
    private final AiCrypto crypto = new AiCrypto("unit-test-key");
    private final WeComGroupRobotService service = new WeComGroupRobotService(mapper, corpMapper,
            corpService, bindMapper, crypto, props, rest, json);

    @BeforeEach
    void setUp() {
        when(props.getApiBaseUrl()).thenReturn("https://qyapi.weixin.qq.com");
    }

    @Test
    void createEncryptsWebhookAndOnlyReturnsMask() {
        enabledCorp("ww-a", "甲方");
        captureInsertAndReadBack();

        Map<String, Object> view = service.create("W1", "admin", request("ww-a", "甲方发布群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=super-secret-key"));

        WeComGroupRobot saved = lastInserted;
        assertTrue(saved.getWebhookCipher().startsWith("v1:"));
        assertFalse(saved.getWebhookCipher().contains("super-secret-key"));
        assertFalse(view.containsKey("webhookCipher"));
        assertEquals("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****", view.get("webhookMasked"));
        assertFalse(String.valueOf(view.values()).contains("super-secret-key"));
        assertEquals("active", view.get("status"));
    }

    @Test
    void webhookMustBeOfficialWeComAddress() {
        enabledCorp("ww-a", "甲方");

        assertRejected("https://evil.example.com/cgi-bin/webhook/send?key=k", "官方");
        assertRejected("https://qyapi.weixin.qq.com/cgi-bin/message/send?key=k", "webhook/send");
        assertRejected("https://qyapi.weixin.qq.com/cgi-bin/webhook/send", "key");
        assertRejected("http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k", "官方");
        verify(mapper, never()).insert(any(WeComGroupRobot.class));
    }

    @Test
    void createRequiresCorpEnabledInWorkspace() {
        enabledCorp("ww-a", "甲方");
        when(corpService.enabledForWorkspace("W1", "ww-b")).thenReturn(false);
        WeComCorp other = corp("ww-b", "乙方");
        when(corpMapper.selectByCorpId("ww-b")).thenReturn(other);

        AppException e = assertThrows(AppException.class, () -> service.create("W1", "admin",
                request("ww-b", "乙方群", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k")));
        assertEquals(400, e.getCode());
        assertTrue(e.getMessage().contains("未在本空间启用"));
    }

    @Test
    void noRobotsMeansNotConfiguredForLegacyFallback() {
        when(mapper.selectActiveByWorkspace("W1"))
                .thenReturn(Collections.<WeComGroupRobot>emptyList());

        WeComGroupRobotService.GroupSendResult result =
                service.sendForRecipients("W1", Arrays.asList("u1"), "发布通知");

        assertFalse(result.isConfigured());
        assertFalse(result.isSent());
        assertNull(result.getReason());
        verify(rest, never()).postForObject(anyString(), any(), eq(String.class));
    }

    @Test
    void sendsOnlyToGroupsOfRecipientCorps() {
        WeComGroupRobot robotA = robot("R1", "ww-a", "甲方群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-a");
        WeComGroupRobot robotB = robot("R2", "ww-b", "乙方群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-b");
        when(mapper.selectActiveByWorkspace("W1")).thenReturn(Arrays.asList(robotA, robotB));
        when(bindMapper.selectByUser("u1")).thenReturn(Collections.singletonList(bind("ww-a")));
        when(corpMapper.selectByCorpId("ww-a")).thenReturn(corp("ww-a", "甲方"));
        when(corpMapper.selectByCorpId("ww-b")).thenReturn(corp("ww-b", "乙方"));
        when(corpService.enabledForWorkspace(anyString(), anyString())).thenReturn(true);
        when(rest.postForObject(anyString(), any(), eq(String.class))).thenReturn(OK);

        WeComGroupRobotService.GroupSendResult result =
                service.sendForRecipients("W1", Arrays.asList("u1"), "发布通知");

        assertTrue(result.isConfigured());
        assertTrue(result.isSent());
        assertEquals(1, result.getTotal());
        assertEquals(1, result.getSucceeded());
        assertNull(result.getReason());
        ArgumentCaptor<String> url = ArgumentCaptor.forClass(String.class);
        verify(rest).postForObject(url.capture(), any(), eq(String.class));
        assertTrue(url.getValue().contains("key-a"));
        assertFalse(url.getValue().contains("key-b"));
    }

    @Test
    void partialFailureExplainsWhichGroupFailed() {
        WeComGroupRobot robotA = robot("R1", "ww-a", "甲方群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-a");
        WeComGroupRobot robotB = robot("R2", "ww-a", "甲方备份群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-b");
        when(mapper.selectActiveByWorkspace("W1")).thenReturn(Arrays.asList(robotA, robotB));
        when(bindMapper.selectByUser("u1")).thenReturn(Collections.singletonList(bind("ww-a")));
        when(corpMapper.selectByCorpId("ww-a")).thenReturn(corp("ww-a", "甲方"));
        when(corpService.enabledForWorkspace(anyString(), anyString())).thenReturn(true);
        when(rest.postForObject(anyString(), any(), eq(String.class)))
                .thenReturn(OK)
                .thenThrow(new IllegalStateException("boom"));

        WeComGroupRobotService.GroupSendResult result =
                service.sendForRecipients("W1", Arrays.asList("u1"), "发布通知");

        assertTrue(result.isSent());
        assertEquals(2, result.getTotal());
        assertEquals(1, result.getSucceeded());
        assertEquals(1, result.getFailed());
        assertTrue(result.getReason().contains("甲方备份群"));
        assertFalse(result.getReason().contains("boom"));
    }

    @Test
    void testSendSuccessWritesLastResult() {
        WeComGroupRobot robotA = robot("R1", "ww-a", "甲方群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-a");
        when(mapper.selectById("W1", "R1")).thenReturn(robotA);
        when(rest.postForObject(anyString(), any(), eq(String.class))).thenReturn(OK);

        Map<String, Object> result = service.test("W1", "R1");

        assertEquals(Boolean.TRUE, result.get("sent"));
        verify(mapper).updateResult(eq("R1"), any(), eq("success"));
    }

    @Test
    void testSendBusinessErrorIsReportedWithoutLeakingKey() {
        WeComGroupRobot robotA = robot("R1", "ww-a", "甲方群",
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=key-a");
        when(mapper.selectById("W1", "R1")).thenReturn(robotA);
        when(rest.postForObject(anyString(), any(), eq(String.class)))
                .thenReturn("{\"errcode\":93000,\"errmsg\":\"invalid webhook url, hint: [abc], from ip: 1.2.3.4, more info at https://open.work.weixin.qq.com\"}");

        Map<String, Object> result = service.test("W1", "R1");

        assertEquals(Boolean.FALSE, result.get("sent"));
        assertTrue(String.valueOf(result.get("message")).contains("invalid webhook url"));
        assertFalse(String.valueOf(result.get("message")).contains("hint:"));
        assertFalse(String.valueOf(result.get("message")).contains("key-a"));
    }

    private WeComGroupRobot lastInserted;

    private void captureInsertAndReadBack() {
        doAnswer(invocation -> {
            lastInserted = invocation.getArgument(0);
            return null;
        }).when(mapper).insert(any(WeComGroupRobot.class));
        when(mapper.selectById(eq("W1"), anyString())).thenAnswer(invocation -> lastInserted);
    }

    private void assertRejected(String webhook, String expectedFragment) {
        AppException e = assertThrows(AppException.class, () -> service.create("W1", "admin",
                request("ww-a", "甲方群", webhook)));
        assertEquals(400, e.getCode());
        assertTrue(e.getMessage().contains(expectedFragment), e.getMessage());
    }

    private void enabledCorp(String corpId, String corpName) {
        WeComCorp corp = corp(corpId, corpName);
        when(corpMapper.selectByCorpId(corpId)).thenReturn(corp);
        when(corpService.enabledForWorkspace("W1", corpId)).thenReturn(true);
    }

    private static WeComCorp corp(String corpId, String corpName) {
        WeComCorp corp = new WeComCorp();
        corp.setCorpId(corpId);
        corp.setCorpName(corpName);
        corp.setStatus("active");
        return corp;
    }

    private static WeComUserBind bind(String corpId) {
        WeComUserBind bind = new WeComUserBind();
        bind.setUserId("u1");
        bind.setCorpId(corpId);
        bind.setStatus("active");
        return bind;
    }

    private static WeComGroupRobot robot(String id, String corpId, String name, String webhook) {
        WeComGroupRobot robot = new WeComGroupRobot();
        robot.setId(id);
        robot.setWorkspaceId("W1");
        robot.setCorpId(corpId);
        robot.setName(name);
        robot.setStatus("active");
        robot.setWebhookCipher(new AiCrypto("unit-test-key").encrypt(webhook));
        return robot;
    }

    private static WeComGroupRobotRequest request(String corpId, String name, String webhook) {
        WeComGroupRobotRequest req = new WeComGroupRobotRequest();
        req.setCorpId(corpId);
        req.setName(name);
        req.setWebhook(webhook);
        return req;
    }
}