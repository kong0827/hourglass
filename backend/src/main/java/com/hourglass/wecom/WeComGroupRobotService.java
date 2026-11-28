package com.hourglass.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComGroupRobot;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.mapper.WeComGroupRobotMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 空间按企业配置的企业微信群机器人。
 *
 * <p>每个机器人属于本空间启用的某家企业；只接受企业微信官方 {@code /cgi-bin/webhook/send}
 * 地址，Webhook 以 AES-GCM 密文保存，接口只回显掩码。发布准备推送按收件人绑定的企业筛选，
 * 只发到相关企业的群，避免甲方发布信息落到无关供应商群。
 */
@Service
public class WeComGroupRobotService {

    private static final String WEBHOOK_PATH = "/cgi-bin/webhook/send";
    private static final int TEXT_BYTE_LIMIT = 1900;

    private final WeComGroupRobotMapper mapper;
    private final WeComCorpMapper corpMapper;
    private final WeComCorpService corpService;
    private final WeComUserBindMapper bindMapper;
    private final AiCrypto crypto;
    private final WeComProperties props;
    private final RestTemplate rest;
    private final ObjectMapper json;

    public WeComGroupRobotService(WeComGroupRobotMapper mapper,
                                  WeComCorpMapper corpMapper,
                                  WeComCorpService corpService,
                                  WeComUserBindMapper bindMapper,
                                  AiCrypto crypto,
                                  WeComProperties props,
                                  @Qualifier("webhookRestTemplate") RestTemplate rest,
                                  ObjectMapper json) {
        this.mapper = mapper;
        this.corpMapper = corpMapper;
        this.corpService = corpService;
        this.bindMapper = bindMapper;
        this.crypto = crypto;
        this.props = props;
        this.rest = rest;
        this.json = json;
    }

    public List<Map<String, Object>> list(String workspaceId) {
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (WeComGroupRobot robot : mapper.selectByWorkspace(workspaceId)) {
            result.add(view(robot));
        }
        return result;
    }

    public Map<String, Object> create(String workspaceId, String operatorId, WeComGroupRobotRequest req) {
        WeComCorp corp = requireEnabledCorp(workspaceId, req.getCorpId());
        String name = requireName(req.getName());
        requireUniqueName(workspaceId, corp.getCorpId(), name, null);
        String webhook = requireWebhook(req.getWebhook());
        LocalDateTime now = LocalDateTime.now();
        WeComGroupRobot robot = new WeComGroupRobot();
        robot.setId(Ids.gen("WG"));
        robot.setWorkspaceId(workspaceId);
        robot.setCorpId(corp.getCorpId());
        robot.setName(name);
        robot.setWebhookCipher(crypto.encrypt(webhook));
        robot.setStatus(statusOrDefault(req.getStatus()));
        robot.setCreatedBy(operatorId);
        robot.setCreatedAt(now);
        robot.setUpdatedAt(now);
        mapper.insert(robot);
        return view(mapper.selectById(workspaceId, robot.getId()));
    }

    public Map<String, Object> update(String workspaceId, String id, WeComGroupRobotRequest req) {
        WeComGroupRobot robot = requireRobot(workspaceId, id);
        WeComCorp corp = requireEnabledCorp(workspaceId, req.getCorpId());
        String name = requireName(req.getName());
        requireUniqueName(workspaceId, corp.getCorpId(), name, id);
        robot.setCorpId(corp.getCorpId());
        robot.setName(name);
        if (Texts.trimToNull(req.getWebhook()) != null) {
            robot.setWebhookCipher(crypto.encrypt(requireWebhook(req.getWebhook())));
        }
        mapper.update(robot);
        return view(mapper.selectById(workspaceId, id));
    }

    public void setStatus(String workspaceId, String id, String status) {
        requireRobot(workspaceId, id);
        if (!"active".equals(status) && !"disabled".equals(status)) {
            throw AppException.badRequest("状态只能是 active 或 disabled");
        }
        mapper.updateStatus(workspaceId, id, status);
    }

    public void delete(String workspaceId, String id) {
        requireRobot(workspaceId, id);
        mapper.deleteById(workspaceId, id);
    }

    /** 发一条测试消息，结果写回 last_result，便于设置页直接看到成功或失败原因。 */
    public Map<String, Object> test(String workspaceId, String id) {
        WeComGroupRobot robot = requireRobot(workspaceId, id);
        String error = send(robot, "【沙漏】群机器人连通性测试，收到即表示配置可用。");
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        if (error == null) {
            result.put("sent", Boolean.TRUE);
            result.put("message", "测试消息已发送");
        } else {
            result.put("sent", Boolean.FALSE);
            result.put("message", error);
        }
        return result;
    }

    /**
     * 按收件人绑定的企业发送到相关群机器人；没有配置任何机器人时 configured=false，
     * 由调用方决定是否回退到空间级群机器人。
     */
    public GroupSendResult sendForRecipients(String workspaceId, Collection<String> userIds, String content) {
        List<WeComGroupRobot> active = mapper.selectActiveByWorkspace(workspaceId);
        if (active.isEmpty()) {
            return GroupSendResult.notConfigured();
        }
        Set<String> corps = boundCorps(userIds);
        List<WeComGroupRobot> targets = new ArrayList<WeComGroupRobot>();
        for (WeComGroupRobot robot : active) {
            if (!corps.contains(robot.getCorpId())) continue;
            WeComCorp corp = corpMapper.selectByCorpId(robot.getCorpId());
            if (corp == null || !"active".equals(corp.getStatus())) continue;
            if (!corpService.enabledForWorkspace(workspaceId, robot.getCorpId())) continue;
            targets.add(robot);
        }
        if (targets.isEmpty()) {
            return new GroupSendResult(true, false, 0, 0, 0,
                    "本次收件人所在企业没有配置可用的群机器人");
        }
        String text = clamp(content);
        int succeeded = 0;
        List<String> failures = new ArrayList<String>();
        for (WeComGroupRobot robot : targets) {
            String error = send(robot, text);
            if (error == null) {
                succeeded++;
            } else {
                failures.add((Texts.trimToNull(robot.getName()) == null ? "未命名群" : robot.getName()) + "：" + error);
            }
        }
        int failed = targets.size() - succeeded;
        String reason = null;
        if (failed > 0) {
            reason = failed + " 个群发送失败（" + Texts.cut(String.join("；", failures), 180) + "）";
        }
        return new GroupSendResult(true, succeeded > 0, targets.size(), succeeded, failed, reason);
    }

    /** 企业删除前调用：该企业还有群机器人时不允许静默删除。 */
    public int countByCorp(String workspaceId, String corpId) {
        return mapper.countByCorp(workspaceId, corpId);
    }

    private Set<String> boundCorps(Collection<String> userIds) {
        Set<String> corps = new HashSet<String>();
        if (userIds == null) return corps;
        for (String userId : userIds) {
            for (WeComUserBind bind : bindMapper.selectByUser(userId)) {
                if ("active".equals(bind.getStatus())) {
                    corps.add(bind.getCorpId());
                }
            }
        }
        return corps;
    }

    /** 发送成功返回 null，失败返回可直接展示的中文原因；地址里的 key 不进入结果与日志。 */
    private String send(WeComGroupRobot robot, String content) {
        String url;
        try {
            url = crypto.decrypt(robot.getWebhookCipher());
        } catch (Exception e) {
            return recordFailure(robot, "Webhook 解密失败，请重新填写");
        }
        String invalid = checkWebhook(url);
        if (invalid != null) {
            return recordFailure(robot, invalid);
        }
        Map<String, Object> text = new LinkedHashMap<String, Object>();
        text.put("content", content);
        Map<String, Object> payload = new LinkedHashMap<String, Object>();
        payload.put("msgtype", "text");
        payload.put("text", text);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        try {
            String resp = rest.postForObject(url, new HttpEntity<Map<String, Object>>(payload, headers), String.class);
            JsonNode node = Texts.trimToNull(resp) == null ? null : json.readTree(resp);
            if (node == null || !node.has("errcode") || node.path("errcode").asInt(-1) != 0) {
                String detail = node == null ? "空响应" : shortErrmsg(node.path("errmsg").asText(""));
                return recordFailure(robot, "企业微信返回失败" + (detail.isEmpty() ? "" : "：" + detail));
            }
            mapper.updateResult(robot.getId(), LocalDateTime.now(), "success");
            return null;
        } catch (Exception e) {
            return recordFailure(robot, "请求失败，详见服务日志");
        }
    }

    private String recordFailure(WeComGroupRobot robot, String reason) {
        mapper.updateResult(robot.getId(), LocalDateTime.now(), Texts.cut("failed:" + reason, 255));
        return reason;
    }

    /** 企微 errmsg 常带 hint / 出口 IP / 排查链接，落库与页面只留第一段原因。 */
    private static String shortErrmsg(String errmsg) {
        if (errmsg == null) return "";
        int cut = errmsg.indexOf(", hint:");
        return cut > 0 ? errmsg.substring(0, cut).trim() : errmsg.trim();
    }

    private WeComGroupRobot requireRobot(String workspaceId, String id) {
        WeComGroupRobot robot = mapper.selectById(workspaceId, id);
        if (robot == null) {
            throw AppException.notFound("群机器人不存在");
        }
        return robot;
    }

    private WeComCorp requireEnabledCorp(String workspaceId, String corpId) {
        String value = Texts.trimToNull(corpId);
        if (value == null) {
            throw AppException.badRequest("请选择企业");
        }
        WeComCorp corp = corpMapper.selectByCorpId(value);
        if (corp == null || !"active".equals(corp.getStatus())) {
            throw AppException.badRequest("企业不存在或已停用");
        }
        if (!corpService.enabledForWorkspace(workspaceId, corp.getCorpId())) {
            throw AppException.badRequest("该企业未在本空间启用");
        }
        return corp;
    }

    private String requireName(String raw) {
        String name = Texts.trimToNull(raw);
        if (name == null) {
            throw AppException.badRequest("请填写群名称");
        }
        if (name.length() > 64) {
            throw AppException.badRequest("群名称最多 64 个字符");
        }
        return name;
    }

    private void requireUniqueName(String workspaceId, String corpId, String name, String excludeId) {
        if (mapper.countByName(workspaceId, corpId, name, excludeId) > 0) {
            throw AppException.conflict("同一企业下已有同名群机器人");
        }
    }

    private String statusOrDefault(String status) {
        String value = Texts.trimToNull(status);
        return "disabled".equals(value) ? "disabled" : "active";
    }

    private String requireWebhook(String raw) {
        String url = Texts.trimToNull(raw);
        if (url == null) {
            throw AppException.badRequest("请填写群机器人 Webhook 地址");
        }
        String invalid = checkWebhook(url);
        if (invalid != null) {
            throw AppException.badRequest(invalid);
        }
        return url;
    }

    /**
     * 只接受与企业微信接口同源、路径为 /cgi-bin/webhook/send 且带 key 的地址；
     * 既阻止任意 URL 出站（SSRF），也避免把普通 webhook 误填成群机器人。
     */
    private String checkWebhook(String raw) {
        URI uri;
        try {
            uri = URI.create(raw);
        } catch (RuntimeException e) {
            return "Webhook 地址格式不正确";
        }
        if (uri.getHost() == null || uri.getScheme() == null) {
            return "Webhook 地址格式不正确";
        }
        URI base;
        try {
            base = URI.create(props.getApiBaseUrl());
        } catch (RuntimeException e) {
            return "企业微信接口地址配置异常";
        }
        String scheme = uri.getScheme().toLowerCase();
        String baseScheme = base.getScheme() == null ? "" : base.getScheme().toLowerCase();
        String host = uri.getHost().toLowerCase();
        String baseHost = base.getHost() == null ? "" : base.getHost().toLowerCase();
        if (!scheme.equals(baseScheme) || !host.equals(baseHost) || port(uri) != port(base)) {
            return "只接受企业微信官方群机器人地址（" + base.getScheme() + "://" + base.getHost() + "）";
        }
        if (!WEBHOOK_PATH.equals(uri.getPath())) {
            return "群机器人地址应指向 " + WEBHOOK_PATH;
        }
        if (queryValue(uri.getRawQuery(), "key") == null) {
            return "群机器人地址缺少 key 参数";
        }
        return null;
    }

    private static int port(URI uri) {
        if (uri.getPort() > 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static String queryValue(String rawQuery, String key) {
        if (rawQuery == null) return null;
        for (String part : rawQuery.split("&")) {
            int idx = part.indexOf('=');
            String k = idx < 0 ? part : part.substring(0, idx);
            if (key.equals(k)) {
                String v = idx < 0 ? "" : part.substring(idx + 1);
                return v.isEmpty() ? null : v;
            }
        }
        return null;
    }

    private Map<String, Object> view(WeComGroupRobot robot) {
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("id", robot.getId());
        item.put("corpId", robot.getCorpId());
        item.put("corpName", robot.getCorpName());
        item.put("name", robot.getName());
        item.put("status", robot.getStatus());
        item.put("webhookMasked", maskWebhook(robot.getWebhookCipher()));
        item.put("lastSentAt", robot.getLastSentAt());
        item.put("lastResult", robot.getLastResult());
        item.put("createdAt", robot.getCreatedAt());
        return item;
    }

    private String maskWebhook(String cipher) {
        try {
            URI uri = URI.create(crypto.decrypt(cipher));
            return uri.getScheme() + "://" + uri.getHost() + uri.getPath() + "?key=****";
        } catch (Exception e) {
            return "已配置";
        }
    }

    /** 企微群机器人 text 上限 2048 字节，按 UTF-8 边界截断并加省略号。 */
    private static String clamp(String content) {
        String text = content == null ? "" : content;
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= TEXT_BYTE_LIMIT) return text;
        int end = TEXT_BYTE_LIMIT;
        while (end > 0 && (bytes[end] & 0xC0) == 0x80) end--;
        return new String(bytes, 0, end, StandardCharsets.UTF_8) + "…";
    }

    /** 一次按企业群推送的汇总结果；configured=false 表示本空间还没配任何群机器人。 */
    public static final class GroupSendResult {
        private final boolean configured;
        private final boolean sent;
        private final int total;
        private final int succeeded;
        private final int failed;
        private final String reason;

        GroupSendResult(boolean configured, boolean sent, int total, int succeeded, int failed, String reason) {
            this.configured = configured;
            this.sent = sent;
            this.total = total;
            this.succeeded = succeeded;
            this.failed = failed;
            this.reason = reason;
        }

        static GroupSendResult notConfigured() {
            return new GroupSendResult(false, false, 0, 0, 0, null);
        }

        public boolean isConfigured() { return configured; }
        public boolean isSent() { return sent; }
        public int getTotal() { return total; }
        public int getSucceeded() { return succeeded; }
        public int getFailed() { return failed; }
        public String getReason() { return reason; }
    }
}