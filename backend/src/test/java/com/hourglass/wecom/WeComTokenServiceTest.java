package com.hourglass.wecom;

import com.hourglass.entity.WeComCorp;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeComTokenServiceTest {

    @Test
    void tokenIsCachedPerCorp() {
        WeComApiClient api = mock(WeComApiClient.class);
        WeComCorpService corps = mock(WeComCorpService.class);
        when(corps.secretOf(org.mockito.ArgumentMatchers.any(WeComCorp.class))).thenReturn("secret");
        when(api.getToken(anyString(), anyString()))
                .thenReturn(new WeComApiClient.TokenResult("tok", 7200));
        WeComTokenService service = new WeComTokenService(api, corps);

        WeComCorp alpha = corp("ww_alpha");
        assertEquals("tok", service.token(alpha));
        assertEquals("tok", service.token(alpha));
        verify(api, times(1)).getToken(anyString(), anyString());
    }

    @Test
    void invalidatingOneCorpDoesNotDropOthers() {
        WeComApiClient api = mock(WeComApiClient.class);
        WeComCorpService corps = mock(WeComCorpService.class);
        when(corps.secretOf(org.mockito.ArgumentMatchers.any(WeComCorp.class))).thenReturn("secret");
        when(api.getToken(anyString(), anyString()))
                .thenReturn(new WeComApiClient.TokenResult("tok", 7200));
        WeComTokenService service = new WeComTokenService(api, corps);

        WeComCorp alpha = corp("ww_alpha");
        WeComCorp beta = corp("ww_beta");
        service.token(alpha);
        service.token(beta);
        service.invalidate("ww_alpha");
        service.token(beta);
        verify(api, times(2)).getToken(anyString(), anyString());

        service.token(alpha);
        verify(api, times(3)).getToken(anyString(), anyString());
    }

    private static WeComCorp corp(String corpId) {
        WeComCorp c = new WeComCorp();
        c.setId("C-" + corpId);
        c.setCorpId(corpId);
        c.setCorpName(corpId);
        return c;
    }
}