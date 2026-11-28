package com.hourglass.wecom;

import com.hourglass.entity.WeComCorp;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

class WeComOAuthServiceTest {

    private final WeComCorp corp = corp("ww_alpha", "100001", "https://pm.alpha.com/hourglass");

    @Test
    void authorizeUrlCarriesCorpAppAndAgent() {
        WeComOAuthService service = service();
        String url = service.authorizeUrl(corp, "state-1");

        assertTrue(url.startsWith("https://open.weixin.qq.com/connect/oauth2/authorize?"));
        assertTrue(url.contains("appid=ww_alpha"));
        assertTrue(url.contains("agentid=100001"));
        assertTrue(url.contains("state=state-1"));
        /* redirect_uri 必须整串编码，否则回调地址里的路径会被企微截断 */
        assertTrue(url.contains("redirect_uri=https%3A%2F%2Fpm.alpha.com%2Fhourglass%2Fwecom%2Fcallback"));
        assertTrue(url.endsWith("#wechat_redirect"));
    }

    @Test
    void differentCorpsPointToTheirOwnCallbackDomain() {
        WeComOAuthService service = service();
        String a = service.authorizeUrl(corp, "s1");
        String b = service.authorizeUrl(corp("ww_beta", "200002", "https://pm.beta.com/hourglass"), "s2");

        assertTrue(a.contains("ww_alpha"));
        assertTrue(a.contains("pm.alpha.com"));
        assertTrue(b.contains("ww_beta"));
        assertTrue(b.contains("pm.beta.com"));
    }

    private WeComOAuthService service() {
        return new WeComOAuthService(mock(WeComProperties.class), mock(WeComCorpService.class),
                mock(WeComStateService.class), mock(WeComApiClient.class), mock(WeComTokenService.class),
                mock(WeComBindingService.class), mock(WeComSessionService.class));
    }

    private static WeComCorp corp(String corpId, String agentId, String base) {
        WeComCorp c = new WeComCorp();
        c.setCorpId(corpId);
        c.setAgentId(agentId);
        c.setCorpName(corpId);
        c.setCallbackBaseUrl(base);
        return c;
    }
}