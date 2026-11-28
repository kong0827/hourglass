package com.hourglass.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 企业微信服务端接口（按企业传参，不持有任何企业状态）。
 * 出站只走固定域名 api-base-url，不接受用户填写的任意地址。
 */
@Component
public class WeComApiClient {

    private final RestTemplate rest;
    private final ObjectMapper json;
    private final WeComProperties props;

    public WeComApiClient(@Qualifier("wecomRestTemplate") RestTemplate rest,
                          ObjectMapper json, WeComProperties props) {
        this.rest = rest;
        this.json = json;
        this.props = props;
    }

    public TokenResult getToken(String corpId, String secret) {
        String url = props.getApiBaseUrl() + "/cgi-bin/gettoken?corpid=" + enc(corpId)
                + "&corpsecret=" + enc(secret);
        JsonNode node = get(url);
        requireOk(node);
        String token = text(node, "access_token");
        if (token == null) {
            throw new WeComApiException(-1, "gettoken 未返回 access_token");
        }
        return new TokenResult(token, node.path("expires_in").asInt(7200));
    }

    /** snsapi_base 授权：code 换成员身份；非企业成员时 userid 为空 */
    public UserInfo getUserByCode(String token, String code) {
        String url = props.getApiBaseUrl() + "/cgi-bin/auth/getuserinfo?access_token=" + enc(token)
                + "&code=" + enc(code);
        JsonNode node = get(url);
        requireOk(node);
        return new UserInfo(
                text(node, "userid"),
                text(node, "UserId"),
                text(node, "openid"),
                text(node, "deviceId"));
    }

    public SendResult sendMessage(String token, Map<String, Object> payload) {
        String url = props.getApiBaseUrl() + "/cgi-bin/message/send?access_token=" + enc(token);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> resp = rest.postForEntity(url,
                new HttpEntity<Map<String, Object>>(payload, headers), String.class);
        JsonNode node = parse(resp.getBody());
        requireOk(node);
        return new SendResult(
                node.path("errcode").asInt(0),
                text(node, "errmsg"),
                text(node, "invaliduser"),
                text(node, "msgid"));
    }

    public Map<String, Object> textcard(String toUser, String title, String description, String url) {
        Map<String, Object> textcard = new LinkedHashMap<String, Object>();
        textcard.put("title", title);
        textcard.put("description", description == null ? "" : description);
        if (url != null && !url.isEmpty()) {
            textcard.put("url", url);
            textcard.put("btntxt", "查看详情");
        }
        Map<String, Object> payload = new LinkedHashMap<String, Object>();
        payload.put("touser", toUser);
        payload.put("msgtype", "textcard");
        payload.put("agentid", null);
        payload.put("textcard", textcard);
        return payload;
    }

    public Map<String, Object> text(String toUser, String content) {
        Map<String, Object> text = new LinkedHashMap<String, Object>();
        text.put("content", content);
        Map<String, Object> payload = new LinkedHashMap<String, Object>();
        payload.put("touser", toUser);
        payload.put("msgtype", "text");
        payload.put("text", text);
        return payload;
    }

    private JsonNode get(String url) {
        ResponseEntity<String> resp = rest.getForEntity(url, String.class);
        return parse(resp.getBody());
    }

    private JsonNode parse(String body) {
        if (body == null || body.trim().isEmpty()) {
            throw new WeComApiException(-1, "企微接口返回空内容");
        }
        try {
            return json.readTree(body);
        } catch (Exception e) {
            throw new WeComApiException(-1, "企微接口返回非 JSON");
        }
    }

    private static void requireOk(JsonNode node) {
        int errcode = node.path("errcode").asInt(0);
        if (errcode != 0) {
            throw new WeComApiException(errcode, node.path("errmsg").asText(""));
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            return null;
        }
        String s = v.asText();
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }

    private static String enc(String value) {
        try {
            return java.net.URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    public static class TokenResult {
        private final String token;
        private final int expiresIn;

        public TokenResult(String token, int expiresIn) {
            this.token = token;
            this.expiresIn = expiresIn;
        }

        public String getToken() {
            return token;
        }

        public int getExpiresIn() {
            return expiresIn;
        }
    }

    public static class UserInfo {
        private final String userId;
        private final String userIdCamel;
        private final String openId;
        private final String deviceId;

        public UserInfo(String userId, String userIdCamel, String openId, String deviceId) {
            this.userId = userId;
            this.userIdCamel = userIdCamel;
            this.openId = openId;
            this.deviceId = deviceId;
        }

        /** 不同接口版本返回 userid / UserId，取到哪个用哪个 */
        public String effectiveUserId() {
            return userId != null ? userId : userIdCamel;
        }

        public String getOpenId() {
            return openId;
        }

        public String getDeviceId() {
            return deviceId;
        }
    }

    public static class SendResult {
        private final int errcode;
        private final String errmsg;
        private final String invalidUser;
        private final String msgId;

        public SendResult(int errcode, String errmsg, String invalidUser, String msgId) {
            this.errcode = errcode;
            this.errmsg = errmsg;
            this.invalidUser = invalidUser;
            this.msgId = msgId;
        }

        public int getErrcode() {
            return errcode;
        }

        public String getErrmsg() {
            return errmsg;
        }

        public String getInvalidUser() {
            return invalidUser;
        }

        public String getMsgId() {
            return msgId;
        }
    }
}