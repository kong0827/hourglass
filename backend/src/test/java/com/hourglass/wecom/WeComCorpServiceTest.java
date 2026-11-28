package com.hourglass.wecom;

import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComCorpSpace;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.mapper.WeComCorpSpaceMapper;
import com.hourglass.mapper.WeComGroupRobotMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeComCorpServiceTest {

    private final WeComCorpMapper corpMapper = mock(WeComCorpMapper.class);
    private final WeComCorpSpaceMapper spaceMapper = mock(WeComCorpSpaceMapper.class);
    private final WeComUserBindMapper bindMapper = mock(WeComUserBindMapper.class);
    private final WeComGroupRobotMapper groupRobotMapper = mock(WeComGroupRobotMapper.class);
    private final WorkspaceMapper workspaceMapper = mock(WorkspaceMapper.class);
    private final WeComProperties props = mock(WeComProperties.class);
    private WeComCorpService service;

    @BeforeEach
    void setUp() {
        when(props.isEnabled()).thenReturn(true);
        when(props.hostAllowed(anyString())).thenReturn(true);
        service = new WeComCorpService(corpMapper, spaceMapper, bindMapper, groupRobotMapper,
                workspaceMapper, new AiCrypto("unit-test-key"), props);
    }

    @Test
    void createEncryptsSecretAndNormalizesCallback() {
        WeComCorpRequest req = request();
        req.setCallbackBaseUrl("https://PM.Corp.COM/hourglass/");

        WeComCorp corp = service.create("A1", req);

        assertEquals("https://pm.corp.com/hourglass", corp.getCallbackBaseUrl());
        assertTrue(corp.getSecretCipher().startsWith("v1:"));
        assertFalse(corp.getSecretCipher().contains("secret-value"));
        assertEquals(16, corp.getCorpKey().length());
        assertEquals("active", corp.getStatus());
        assertNotNull(corp.getCreatedAt());
        assertNotNull(corp.getUpdatedAt());
        verify(corpMapper).insert(any(WeComCorp.class));
    }

    @Test
    void createRejectsDuplicateCorpId() {
        when(corpMapper.selectByCorpId("ww123456")).thenReturn(new WeComCorp());
        AppException e = assertThrows(AppException.class, () -> service.create("A1", request()));
        assertEquals(409, e.getCode());
    }

    @Test
    void callbackHostMustBeWhitelisted() {
        when(props.hostAllowed("pm.corp.com")).thenReturn(false);
        assertThrows(AppException.class, () -> service.create("A1", request()));
    }

    @Test
    void updateWithoutSecretKeepsCipher() {
        WeComCorp existing = new WeComCorp();
        existing.setId("C1");
        existing.setCorpKey("key");
        existing.setCorpId("ww123456");
        existing.setCorpName("甲方");
        existing.setAgentId("100001");
        existing.setSecretCipher("v1:old");
        existing.setCallbackBaseUrl("https://pm.corp.com/hourglass");
        existing.setStatus("active");
        when(corpMapper.selectById("C1")).thenReturn(existing);

        WeComCorpRequest req = request();
        req.setCorpSecret("  ");
        WeComCorp updated = service.update("C1", req);

        assertEquals("v1:old", updated.getSecretCipher());
        verify(corpMapper).update(existing);
    }

    @Test
    void maskNeverReturnsCipher() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        corp.setCorpName("甲方");
        corp.setSecretCipher("v1:secret");
        corp.setCallbackBaseUrl("https://pm.corp.com/hourglass");

        Map<String, Object> view = service.mask(corp);

        assertFalse(view.containsValue("v1:secret"));
        assertFalse(view.containsKey("secretCipher"));
        assertEquals(Boolean.TRUE, view.get("hasSecret"));
        assertEquals("https://pm.corp.com/hourglass/wecom/callback", view.get("callbackUrl"));
    }

    @Test
    void workspaceEnablementStoresRealCorpId() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        corp.setCorpName("甲方");
        corp.setStatus("active");
        when(corpMapper.selectById("C1")).thenReturn(corp);
        when(spaceMapper.selectCorpIdsByWorkspace("W1")).thenReturn(Collections.<String>emptyList());

        service.setWorkspaceCorps("W1", "A1", Collections.singletonList("C1"));

        ArgumentCaptor<WeComCorpSpace> captor = ArgumentCaptor.forClass(WeComCorpSpace.class);
        verify(spaceMapper).insert(captor.capture());
        assertEquals("ww123456", captor.getValue().getCorpId());
    }

    @Test
    void workspaceCannotEnableDisabledCorp() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        corp.setCorpName("甲方");
        corp.setStatus("disabled");
        when(corpMapper.selectById("C1")).thenReturn(corp);

        assertThrows(AppException.class, () -> service.setWorkspaceCorps("W1", "A1",
                Collections.singletonList("C1")));
        verify(spaceMapper, never()).insert(any(WeComCorpSpace.class));
    }

    @Test
    void deleteRemovesRegistrationAndWorkspaceEnablement() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        corp.setCorpName("甲方");
        when(corpMapper.selectById("C1")).thenReturn(corp);
        when(bindMapper.countByCorp("ww123456")).thenReturn(0);

        service.delete("C1");

        verify(spaceMapper).deleteByCorp("ww123456");
        verify(corpMapper).deleteById("C1");
    }

    @Test
    void deleteRejectsCorpWithBindings() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        when(corpMapper.selectById("C1")).thenReturn(corp);
        when(bindMapper.countByCorp("ww123456")).thenReturn(2);

        AppException e = assertThrows(AppException.class, () -> service.delete("C1"));
        assertEquals(409, e.getCode());
        verify(corpMapper, never()).deleteById(anyString());
    }

    @Test
    void deleteRejectsCorpWithGroupRobots() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        when(corpMapper.selectById("C1")).thenReturn(corp);
        when(groupRobotMapper.countByCorpId("ww123456")).thenReturn(1);

        AppException e = assertThrows(AppException.class, () -> service.delete("C1"));
        assertEquals(409, e.getCode());
        assertTrue(e.getMessage().contains("群机器人"));
        verify(corpMapper, never()).deleteById(anyString());
    }

    @Test
    void workspaceCannotDisableCorpWithGroupRobots() {
        WeComCorp corp = new WeComCorp();
        corp.setId("C1");
        corp.setCorpId("ww123456");
        corp.setCorpName("甲方");
        corp.setStatus("active");
        when(corpMapper.selectById("C1")).thenReturn(corp);
        when(spaceMapper.selectCorpIdsByWorkspace("W1"))
                .thenReturn(Collections.singletonList("ww123456"));
        when(groupRobotMapper.countByCorp("W1", "ww123456")).thenReturn(2);

        AppException e = assertThrows(AppException.class,
                () -> service.setWorkspaceCorps("W1", "A1", Collections.<String>emptyList()));
        assertEquals(409, e.getCode());
        verify(spaceMapper, never()).delete(anyString(), anyString());
    }

    private static WeComCorpRequest request() {
        WeComCorpRequest req = new WeComCorpRequest();
        req.setCorpId("ww123456");
        req.setCorpName("甲方");
        req.setAgentId("100001");
        req.setCorpSecret("secret-value");
        req.setCallbackBaseUrl("https://pm.corp.com/hourglass");
        return req;
    }
}