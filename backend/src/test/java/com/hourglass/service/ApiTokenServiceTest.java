package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ApiTokenAuth;
import com.hourglass.dto.ApiTokenCreateRequest;
import com.hourglass.dto.ApiTokenCreated;
import com.hourglass.dto.ApiTokenView;
import com.hourglass.entity.ApiToken;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.ApiTokenMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApiTokenServiceTest {

    private ApiTokenMapper tokenMapper;
    private UserMapper userMapper;
    private SessionEpochService epochs;
    private PasswordEncoder passwordEncoder;
    private ApiTokenService service;
    private AppUser user;

    @BeforeEach
    void setUp() {
        tokenMapper = mock(ApiTokenMapper.class);
        userMapper = mock(UserMapper.class);
        epochs = mock(SessionEpochService.class);
        passwordEncoder = mock(PasswordEncoder.class);
        service = new ApiTokenService(tokenMapper, userMapper, epochs, passwordEncoder, 90);

        user = new AppUser();
        user.setId("U1");
        user.setUsername("xiaoming");
        user.setDisplayName("小明");
        user.setRole("user");
        user.setPasswordHash("hash");
        user.setDisabled(false);
        when(userMapper.selectById("U1")).thenReturn(user);
        when(epochs.current("U1")).thenReturn(3L);
    }

    private ApiTokenCreateRequest request(String scope) {
        ApiTokenCreateRequest req = new ApiTokenCreateRequest();
        req.setName("Qoder 只读");
        req.setScope(scope);
        req.setPassword("secret");
        return req;
    }

    @Test
    void createRejectsWrongPassword() {
        when(passwordEncoder.matches("secret", "hash")).thenReturn(false);
        AppException e = assertThrows(AppException.class, () ->
                service.create("U1", request(null), "10.0.0.1"));
        assertEquals(400, e.getCode());
        assertTrue(e.getMessage().contains("密码"));
        verify(tokenMapper, never()).insert(any(ApiToken.class));
    }

    @Test
    void createAcceptsWriteScope() {
        when(passwordEncoder.matches("secret", "hash")).thenReturn(true);
        ArgumentCaptor<ApiToken> captor = ArgumentCaptor.forClass(ApiToken.class);

        ApiTokenCreated created = service.create("U1", request("write"), "10.0.0.1");

        verify(tokenMapper).insert(captor.capture());
        assertEquals("write", captor.getValue().getScope());
        assertEquals("write", created.getScope());
    }

    @Test
    void createRejectsUnknownScope() {
        when(passwordEncoder.matches("secret", "hash")).thenReturn(true);
        AppException e = assertThrows(AppException.class, () ->
                service.create("U1", request("admin"), "10.0.0.1"));
        assertEquals(400, e.getCode());
        assertTrue(e.getMessage().contains("令牌类型不合法"));
    }

    @Test
    void createReturnsTokenOnlyOnceAndStoresHash() {
        when(passwordEncoder.matches("secret", "hash")).thenReturn(true);
        ArgumentCaptor<ApiToken> captor = ArgumentCaptor.forClass(ApiToken.class);

        ApiTokenCreated created = service.create("U1", request(null), "10.0.0.1");

        verify(tokenMapper).insert(captor.capture());
        ApiToken stored = captor.getValue();
        assertTrue(created.getToken().startsWith("hg_"));
        assertEquals(46, created.getToken().length());
        assertEquals(ApiTokenService.sha256(created.getToken()), stored.getTokenHash());
        assertEquals(created.getToken().substring(0, 11), stored.getPrefix());
        assertEquals("read", stored.getScope());
        assertEquals(3L, stored.getEpoch());
        assertNotNull(stored.getExpiresAt());
        assertEquals(64, stored.getTokenHash().length());
    }

    @Test
    void listNeverCarriesRawToken() {
        ApiToken token = new ApiToken();
        token.setId("T1");
        token.setName("n");
        token.setPrefix("hg_abcdefgh");
        token.setScope("read");
        when(tokenMapper.selectByUser("U1")).thenReturn(Arrays.asList(token));

        ApiTokenView view = service.list("U1").get(0);
        assertEquals("T1", view.getId());
        assertEquals("hg_abcdefgh", view.getPrefix());
    }

    @Test
    void revokeRejectsOtherUsersToken() {
        ApiToken token = new ApiToken();
        token.setId("T1");
        token.setUserId("U2");
        when(tokenMapper.selectById("T1")).thenReturn(token);

        AppException e = assertThrows(AppException.class, () -> service.revoke("U1", "T1"));
        assertEquals(404, e.getCode());
    }

    @Test
    void revokeIsIdempotent() {
        ApiToken token = new ApiToken();
        token.setId("T1");
        token.setUserId("U1");
        token.setRevokedAt(LocalDateTime.now());
        when(tokenMapper.selectById("T1")).thenReturn(token);

        service.revoke("U1", "T1");
        verify(tokenMapper, never()).revoke(any(), any(), any());
    }

    @Test
    void adminRevokeIgnoresOwnership() {
        ApiToken token = new ApiToken();
        token.setId("T9");
        token.setUserId("U2");
        when(tokenMapper.selectById("T9")).thenReturn(token);

        service.adminRevoke("T9");

        verify(tokenMapper).revokeAny(eq("T9"), any(LocalDateTime.class));
    }

    @Test
    void adminListReturnsViewsWithoutRawToken() {
        ApiToken token = new ApiToken();
        token.setId("T1");
        token.setUserId("U2");
        token.setPrefix("hg_abcdefgh");
        when(tokenMapper.selectAll(null)).thenReturn(Arrays.asList(token));

        ApiTokenView view = service.adminList(" ").get(0);
        assertEquals("T1", view.getId());
        assertEquals("hg_abcdefgh", view.getPrefix());
        verify(tokenMapper).selectAll(null);
    }

    private ApiToken validToken() {
        ApiToken token = new ApiToken();
        token.setId("T1");
        token.setUserId("U1");
        token.setTokenHash(ApiTokenService.sha256("hg_raw"));
        token.setScope("read");
        token.setEpoch(3L);
        token.setExpiresAt(LocalDateTime.now().plusDays(1));
        token.setLastUsedAt(LocalDateTime.now());
        return token;
    }

    @Test
    void authenticateAcceptsValidToken() {
        when(tokenMapper.selectByHash(ApiTokenService.sha256("hg_raw"))).thenReturn(validToken());

        ApiTokenAuth auth = service.authenticate("hg_raw");
        assertNotNull(auth);
        assertEquals("xiaoming", auth.getUser().getUsername());
        verify(tokenMapper, never()).touchLastUsed(any(), any());
    }

    @Test
    void authenticateTouchesLastUsedWhenStale() {
        ApiToken token = validToken();
        token.setLastUsedAt(LocalDateTime.now().minusMinutes(10));
        when(tokenMapper.selectByHash(ApiTokenService.sha256("hg_raw"))).thenReturn(token);

        assertNotNull(service.authenticate("hg_raw"));
        verify(tokenMapper).touchLastUsed(eq("T1"), any(LocalDateTime.class));
    }

    @Test
    void authenticateRejectsRevokedExpiredDisabledAndEpochMismatch() {
        ApiToken revoked = validToken();
        revoked.setRevokedAt(LocalDateTime.now());
        when(tokenMapper.selectByHash(ApiTokenService.sha256("hg_raw"))).thenReturn(revoked);
        assertNull(service.authenticate("hg_raw"));

        ApiToken expired = validToken();
        expired.setExpiresAt(LocalDateTime.now().minusSeconds(1));
        when(tokenMapper.selectByHash(ApiTokenService.sha256("hg_raw"))).thenReturn(expired);
        assertNull(service.authenticate("hg_raw"));

        when(tokenMapper.selectByHash(ApiTokenService.sha256("hg_raw"))).thenReturn(validToken());
        user.setDisabled(true);
        assertNull(service.authenticate("hg_raw"));
        user.setDisabled(false);

        when(epochs.current("U1")).thenReturn(4L);
        assertNull(service.authenticate("hg_raw"));
    }

    @Test
    void authenticateRejectsUnknownToken() {
        when(tokenMapper.selectByHash(any())).thenReturn(null);
        assertNull(service.authenticate("hg_unknown"));
        assertNull(service.authenticate(""));
    }

    @Test
    void sha256IsStableHex() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                ApiTokenService.sha256("abc"));
        assertFalse(ApiTokenService.sha256("abc").contains("-"));
    }
}