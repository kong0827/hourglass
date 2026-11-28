package com.hourglass.wecom;

import com.hourglass.common.AppException;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeComBindingServiceTest {

    private final WeComUserBindMapper mapper = mock(WeComUserBindMapper.class);
    private final WeComCorpService corps = mock(WeComCorpService.class);
    private final UserMapper users = mock(UserMapper.class);
    private WeComBindingService service;

    @BeforeEach
    void setUp() {
        service = new WeComBindingService(mapper, corps, users);
        AppUser user = new AppUser();
        user.setId("U1");
        user.setUsername("zhang");
        when(users.selectById("U1")).thenReturn(user);
        when(corps.availableToUser("ww_a", "U1")).thenReturn(true);
    }

    @Test
    void createsBindingForSameEmployer() {
        WeComUserBind bind = service.bindSelf("U1", "ww_a", "ZhangSan");

        assertEquals("U1", bind.getUserId());
        assertEquals("ww_a", bind.getCorpId());
        assertEquals("zhangsan", bind.getWecomUserid());
        assertEquals("self", bind.getBindSource());
        assertEquals("active", bind.getStatus());
        verify(mapper).insert(any(WeComUserBind.class));
    }

    @Test
    void sameCorpSameUserIsIdempotent() {
        WeComUserBind existing = new WeComUserBind();
        existing.setId("B1");
        existing.setUserId("U1");
        existing.setCorpId("ww_a");
        existing.setWecomUserid("zhangsan");
        existing.setStatus("active");
        when(mapper.selectByCorpUserid("ww_a", "zhangsan")).thenReturn(existing);
        when(mapper.selectByUserAndCorp("U1", "ww_a")).thenReturn(existing);

        WeComUserBind result = service.bindSelf("U1", "ww_a", "zhangsan");

        assertEquals("B1", result.getId());
        verify(mapper, never()).insert(any(WeComUserBind.class));
    }

    @Test
    void wecomAccountCannotMapToTwoLocalUsers() {
        WeComUserBind other = new WeComUserBind();
        other.setUserId("U2");
        other.setCorpId("ww_a");
        other.setWecomUserid("zhangsan");
        when(mapper.selectByCorpUserid("ww_a", "zhangsan")).thenReturn(other);

        AppException e = assertThrows(AppException.class,
                () -> service.bindSelf("U1", "ww_a", "zhangsan"));
        assertEquals(409, e.getCode());
    }

    @Test
    void oneLocalUserCannotHoldTwoAccountsInSameCorp() {
        WeComUserBind mine = new WeComUserBind();
        mine.setUserId("U1");
        mine.setCorpId("ww_a");
        mine.setWecomUserid("zhangsan");
        when(mapper.selectByUserAndCorp("U1", "ww_a")).thenReturn(mine);

        assertThrows(AppException.class, () -> service.bindSelf("U1", "ww_a", "lisi"));
    }

    @Test
    void rejectsBindingOutsideEnabledWorkspaces() {
        when(corps.availableToUser("ww_b", "U1")).thenReturn(false);
        AppException e = assertThrows(AppException.class,
                () -> service.bindSelf("U1", "ww_b", "zhangsan"));
        assertEquals(403, e.getCode());
    }

    @Test
    void findActiveIgnoresDisabledRows() {
        WeComUserBind disabled = new WeComUserBind();
        disabled.setStatus("disabled");
        when(mapper.selectByCorpUserid("ww_a", "zhangsan")).thenReturn(disabled);
        assertEquals(null, service.findActive("ww_a", "ZhangSan"));

        WeComUserBind active = new WeComUserBind();
        active.setStatus("active");
        active.setLastLoginAt(LocalDateTime.now());
        when(mapper.selectByCorpUserid("ww_a", "lisi")).thenReturn(active);
        assertNotNull(service.findActive("ww_a", "lisi"));
    }

    @Test
    void malformedWeComUseridIsRejected() {
        assertThrows(AppException.class, () -> service.bindSelf("U1", "ww_a", "张三"));
        verify(mapper, never()).insert(any(WeComUserBind.class));
    }

    @Test
    void unbindRemovesOwnRow() {
        WeComUserBind bind = new WeComUserBind();
        bind.setId("B1");
        when(mapper.selectByUserAndCorp("U1", "ww_a")).thenReturn(bind);

        service.unbindSelf("U1", "ww_a");

        verify(mapper).deleteById("B1");
    }

    @Test
    void disabledAccountCannotBind() {
        AppUser disabled = new AppUser();
        disabled.setId("U1");
        disabled.setDisabled(Boolean.TRUE);
        when(users.selectById("U1")).thenReturn(disabled);
        assertThrows(AppException.class, () -> service.bindSelf("U1", "ww_a", "zhangsan"));
        verify(mapper, never()).insert(any(WeComUserBind.class));
    }
}