package com.devstudio.kanban.config;

import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.apache.http.client.config.RequestConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.util.concurrent.TimeUnit;

/**
 * 出站 HTTP（AI 上游 / 群机器人 webhook）共用一条连接池。
 *
 * <p>此前每次请求都新建连接、用完即关：AI 长请求与提醒推送并发时容易堆积 TIME_WAIT，
 * 也无法复用 TLS 握手。这里按「一个池 + 两套超时」提供 RestTemplate：
 * <ul>
 *   <li>aiRestTemplate：连接 10s / 读 90s（与 AiClient 的总预算一致）；</li>
 *   <li>webhookRestTemplate：连接 2s / 读 3s（提醒推送不能拖住扫描线程）。</li>
 * </ul>
 * 两者都禁用自动重试与重定向：webhook 地址是用户填写的外部地址，跟随 302 会绕过内网校验。
 */
@Configuration
public class OutboundHttpConfig {

    @Bean(destroyMethod = "close")
    public CloseableHttpClient outboundHttpClient() {
        PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
        cm.setMaxTotal(24);
        cm.setDefaultMaxPerRoute(12);
        /* 复用前校验空闲连接，避免拿到被上游断开的连接 */
        cm.setValidateAfterInactivity(2000);
        return HttpClients.custom()
                .setConnectionManager(cm)
                .evictIdleConnections(30, TimeUnit.SECONDS)
                .evictExpiredConnections()
                .disableAutomaticRetries()
                .setDefaultRequestConfig(RequestConfig.custom()
                        .setConnectTimeout(5000)
                        .setConnectionRequestTimeout(2000)
                        .setSocketTimeout(45000)
                        .setRedirectsEnabled(false)
                        .build())
                .build();
    }

    @Bean
    public RestTemplate aiRestTemplate(CloseableHttpClient outboundHttpClient) {
        HttpComponentsClientHttpRequestFactory f =
                new HttpComponentsClientHttpRequestFactory(outboundHttpClient);
        f.setConnectTimeout(10000);
        f.setReadTimeout(90000);
        return new RestTemplate(f);
    }

    @Bean
    public RestTemplate webhookRestTemplate(CloseableHttpClient outboundHttpClient) {
        HttpComponentsClientHttpRequestFactory f =
                new HttpComponentsClientHttpRequestFactory(outboundHttpClient);
        f.setConnectTimeout(2000);
        f.setReadTimeout(3000);
        return new RestTemplate(f);
    }
}
