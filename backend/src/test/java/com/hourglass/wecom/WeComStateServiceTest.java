package com.hourglass.wecom;

import com.hourglass.entity.WeComOauthState;
import com.hourglass.mapper.WeComOauthStateMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeComStateServiceTest {

    private final WeComOauthStateMapper mapper = mock(WeComOauthStateMapper.class);
    private final WeComProperties props = mock(WeComProperties.class);

    @Test
    void issueStoresExpiryAndSafeTarget() {
        when(props.getStateTtlSeconds()).thenReturn(300);
        WeComStateService service = new WeComStateService(mapper, props);

        String state = service.issue("bind", "ww_alpha", "U1", "https://evil.example", "W1", "1.2.3.4");

        assertEquals(32, state.length());
        ArgumentCaptor<WeComOauthState> captor = ArgumentCaptor.forClass(WeComOauthState.class);
        verify(mapper).insert(captor.capture());
        assertEquals("/", captor.getValue().getTarget());
        assertEquals("bind", captor.getValue().getPurpose());
        assertEquals("ww_alpha", captor.getValue().getCorpId());
        assertTrue(captor.getValue().getExpiresAt().isAfter(java.time.LocalDateTime.now()));
    }

    @Test
    void consumeIsOneShot() {
        when(props.getStateTtlSeconds()).thenReturn(300);
        WeComStateService service = new WeComStateService(mapper, props);
        when(mapper.consume("s1")).thenReturn(0);
        assertNull(service.consume("s1"));
        verify(mapper, never()).selectByState("s1");

        WeComOauthState row = new WeComOauthState();
        row.setState("s2");
        when(mapper.consume("s2")).thenReturn(1);
        when(mapper.selectByState("s2")).thenReturn(row);
        assertNotNull(service.consume("s2"));
    }

    @Test
    void rejectsOversizedOrBlankState() {
        WeComStateService service = new WeComStateService(mapper, props);
        assertNull(service.consume(null));
        assertNull(service.consume("   "));
        assertNull(service.consume(new String(new char[80]).replace('\0', 'a')));
        verify(mapper, never()).consume(any(String.class));
    }
}