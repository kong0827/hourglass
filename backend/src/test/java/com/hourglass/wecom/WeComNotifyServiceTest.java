package com.hourglass.wecom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComMsgLog;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.mapper.WeComMsgLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeComNotifyServiceTest {

    private final WeComMsgLogMapper msgMapper = mock(WeComMsgLogMapper.class);
    private final WeComCorpMapper corpMapper = mock(WeComCorpMapper.class);
    private final WeComCorpService corpService = mock(WeComCorpService.class);
    private final WeComBindingService bindingService = mock(WeComBindingService.class);
    private final WeComTokenService tokenService = mock(WeComTokenService.class);
    private final WeComApiClient api = mock(WeComApiClient.class);
    private final WeComProperties props = mock(WeComProperties.class);
    private final WeComNotifyService service = new WeComNotifyService(msgMapper, corpMapper, corpService,
            bindingService, tokenService, api, props, new ObjectMapper());

    @BeforeEach
    void setUp() {
        when(props.isEnabled()).thenReturn(true);
        when(props.getSendMaxAttempts()).thenReturn(1);
        when(props.getSendRetryBackoffSeconds()).thenReturn(60);
    }

    @Test
    void pushableOnlyCoversThreeEvents() {
        assertTrue(WeComNotifyService.pushable("task_assigned"));
        assertTrue(WeComNotifyService.pushable("test_plan_assigned"));
        assertTrue(WeComNotifyService.pushable("release_prep"));
        assertEquals(false, WeComNotifyService.pushable("task_comment"));
        assertEquals(false, WeComNotifyService.pushable("daily_digest"));
    }

    @Test
    void enqueueBuildsAbsoluteTextcardUrl() {
        WeComCorp corp = corp();

        WeComMsgLog row = service.enqueue(corp, "W1", "zhangsan", "task_assigned",
                "任务指派", "请处理", "/#/board?task=T1");

        ArgumentCaptor<WeComMsgLog> captor = ArgumentCaptor.forClass(WeComMsgLog.class);
        verify(msgMapper).insert(captor.capture());
        WeComMsgLog saved = captor.getValue();
        assertEquals("pending", saved.getStatus());
        assertEquals(Integer.valueOf(0), saved.getAttempts());
        assertEquals("zhangsan", saved.getTouserText());
        assertEquals("100001", saved.getAgentId());
        /* 企微卡片链接必须是绝对地址：相对路径按该企业回调根地址补全 */
        assertTrue(saved.getPayloadJson().contains(
                "\"url\":\"https://pm.corp.com/hourglass/#/board?task=T1\""));
        assertEquals(saved.getId(), row.getId());
    }

    @Test
    void partialResultStopsRetryingAtMaxAttempts() {
        WeComCorp corp = corp();
        when(corpMapper.selectByCorpId("ww123456")).thenReturn(corp);
        when(tokenService.token(corp)).thenReturn("tok");
        when(api.sendMessage(anyString(), any())).thenReturn(new WeComApiClient.SendResult(0, "ok", "baduser", null));
        WeComMsgLog row = new WeComMsgLog();
        row.setId("WM1");
        row.setCorpId("ww123456");
        row.setAgentId("100001");
        row.setPayloadJson("{\"touser\":\"baduser\",\"title\":\"t\",\"description\":\"d\","
                + "\"url\":\"https://pm.corp.com/hourglass/#/board?task=T1\"}");
        row.setStatus("pending");
        row.setAttempts(0);
        when(msgMapper.selectRetryDue(any(LocalDateTime.class), anyInt()))
                .thenReturn(Collections.singletonList(row));

        service.sendPending();

        ArgumentCaptor<WeComMsgLog> captor = ArgumentCaptor.forClass(WeComMsgLog.class);
        verify(msgMapper).updateResult(captor.capture());
        /* 已是最后一次尝试：标记部分失败但不再排重试，避免无效成员永久占队列 */
        assertEquals("partial", captor.getValue().getStatus());
        assertEquals(Integer.valueOf(1), captor.getValue().getAttempts());
        assertNull(captor.getValue().getNextRetryAt());
    }

    @Test
void enqueueForUserCountsOnlyEnabledCorps() {
        WeComUserBind mine = bind("ww123456", "zhangsan", "active");
        WeComUserBind disabled = bind("ww123456", "lisi", "disabled");
        WeComUserBind otherSpace = bind("ww999999", "zhangsan", "active");
        when(bindingService.listForUser("U1")).thenReturn(Arrays.asList(mine, disabled, otherSpace));
        when(corpService.enabledForWorkspace("W1", "ww123456")).thenReturn(true);
        when(corpService.enabledForWorkspace("W1", "ww999999")).thenReturn(false);
        when(corpMapper.selectByCorpId("ww123456")).thenReturn(corp());

        int queued = service.enqueueForUser("W1", "U1", "release_prep", "发布准备", "请确认",
                "/#/release?plan=R1&tab=plan");

        /* 停用绑定与未启用企业都不入队，调用方用返回值判断是否标记「已发企微」 */
        assertEquals(1, queued);
        verify(msgMapper).insert(any(WeComMsgLog.class));
    }

    private static WeComUserBind bind(String corpId, String wecomUserid, String status) {
        WeComUserBind bind = new WeComUserBind();
        bind.setUserId("U1");
        bind.setCorpId(corpId);
        bind.setWecomUserid(wecomUserid);
        bind.setStatus(status);
        return bind;
    }

    private static WeComCorp corp() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpKey("key0123456789ab");
        corp.setCorpId("ww123456");
        corp.setCorpName("甲方");
        corp.setAgentId("100001");
        corp.setCallbackBaseUrl("https://pm.corp.com/hourglass");
        corp.setStatus("active");
        return corp;
    }
}