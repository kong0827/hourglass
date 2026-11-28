package com.hourglass.wecom;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.Ids;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComMsgLog;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.mapper.WeComMsgLogMapper;
import com.hourglass.service.UserNotificationPreferenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 企微应用消息：入队 + 定时发送（不阻塞业务线程）。
 *
 * <p>多企业下同一空间的通知要按接收人绑定的企业分别发：甲方成员走甲方应用，
 * 供应商成员走供应商应用，绝不把所有 userid 丢给同一家的 token。
 */
@Service
public class WeComNotifyService {

    private static final Logger log = LoggerFactory.getLogger(WeComNotifyService.class);

    /** 只推这几类事件：指派、测试指派、发布准备；其它事件仍走站内/邮件，避免绑了免登就被消息淹没 */
    private static final String[] PUSH_EVENTS = {
            UserNotificationPreferenceService.TASK_ASSIGNED,
            UserNotificationPreferenceService.TEST_PLAN_ASSIGNED,
            UserNotificationPreferenceService.RELEASE_PREP
    };

    private final WeComMsgLogMapper msgMapper;
    private final WeComCorpMapper corpMapper;
    private final WeComCorpService corpService;
    private final WeComBindingService bindingService;
    private final WeComTokenService tokenService;
    private final WeComApiClient api;
    private final WeComProperties props;
    private final ObjectMapper json;

    public WeComNotifyService(WeComMsgLogMapper msgMapper, WeComCorpMapper corpMapper,
                              WeComCorpService corpService, WeComBindingService bindingService,
                              WeComTokenService tokenService, WeComApiClient api,
                              WeComProperties props, ObjectMapper json) {
        this.msgMapper = msgMapper;
        this.corpMapper = corpMapper;
        this.corpService = corpService;
        this.bindingService = bindingService;
        this.tokenService = tokenService;
        this.api = api;
        this.props = props;
        this.json = json;
    }

    public static boolean pushable(String eventType) {
        for (String e : PUSH_EVENTS) {
            if (e.equals(eventType)) {
                return true;
            }
        }
        return false;
    }

    /** 按接收人绑定的企业分别入队；只发当前空间启用的企业 */
    public void enqueueForUser(String workspaceId, String userId, String eventType,
                               String title, String body, String path) {
        if (!props.isEnabled() || workspaceId == null || userId == null) {
            return;
        }
        try {
            List<WeComUserBind> binds = bindingService.listForUser(userId);
            for (WeComUserBind bind : binds) {
                if (!"active".equals(bind.getStatus())) {
                    continue;
                }
                if (!corpService.enabledForWorkspace(workspaceId, bind.getCorpId())) {
                    continue;
                }
                WeComCorp corp = corpMapper.selectByCorpId(bind.getCorpId());
                if (corp == null || !"active".equals(corp.getStatus())) {
                    continue;
                }
                enqueue(corp, workspaceId, bind.getWecomUserid(), eventType, title, body, path);
            }
        } catch (Exception e) {
            /* 通知失败不能影响主业务 */
            log.warn("企微消息入队失败（user={} event={}）：{}", userId, eventType, e.getMessage());
        }
    }

    public WeComMsgLog enqueue(WeComCorp corp, String workspaceId, String wecomUserId,
                               String eventType, String title, String body, String path) {
        Map<String, Object> payload = new LinkedHashMap<String, Object>();
        payload.put("touser", wecomUserId);
        payload.put("msgtype", "textcard");
        payload.put("title", cut(title, 120));
        payload.put("description", cut(body, 400));
        payload.put("url", absoluteUrl(corp, path));

        WeComMsgLog row = new WeComMsgLog();
        row.setId(Ids.gen("WM"));
        row.setWorkspaceId(workspaceId);
        row.setCorpId(corp.getCorpId());
        row.setAgentId(corp.getAgentId());
        row.setEventType(cut(eventType, 64));
        row.setTouserText(cut(wecomUserId, 900));
        row.setMsgtype("textcard");
        row.setTitle(cut(title, 120));
        row.setPayloadJson(write(payload));
        row.setStatus("pending");
        row.setAttempts(0);
        row.setNextRetryAt(LocalDateTime.now());
        row.setCreatedAt(LocalDateTime.now());
        row.setUpdatedAt(LocalDateTime.now());
        msgMapper.insert(row);
        return row;
    }

    /** 手工重发：把已失败/未发出的记录重新排到队首 */
    public WeComMsgLog retry(String id) {
        WeComMsgLog row = msgMapper.selectById(id);
        if (row == null) {
            throw com.hourglass.common.AppException.notFound("消息记录不存在");
        }
        row.setStatus("pending");
        row.setAttempts(0);
        row.setNextRetryAt(LocalDateTime.now());
        row.setUpdatedAt(LocalDateTime.now());
        msgMapper.updateResult(row);
        return row;
    }

    @Scheduled(fixedDelayString = "${app.wecom.retry-ms:60000}")
    public void sendPending() {
        if (!props.isEnabled()) {
            return;
        }
        List<WeComMsgLog> due = msgMapper.selectRetryDue(LocalDateTime.now(), 50);
        for (WeComMsgLog row : due) {
            try {
                sendOne(row);
            } catch (Exception e) {
                log.warn("企微消息发送异常（id={}）：{}", row.getId(), e.getMessage());
                fail(row, -1, e.getMessage(), null);
            }
        }
    }

    @Scheduled(cron = "0 45 3 * * *")
    public void cleanup() {
        try {
            msgMapper.deleteOlderThan(LocalDateTime.now().minusDays(30));
        } catch (Exception ignored) {
            /* 清理失败不影响发送 */
        }
    }

    private void sendOne(WeComMsgLog row) {
        WeComCorp corp = corpMapper.selectByCorpId(row.getCorpId());
        if (corp == null || !"active".equals(corp.getStatus())) {
            fail(row, -1, "企业已停用或删除", null);
            return;
        }
        Map<?, ?> stored = read(row.getPayloadJson());
        if (stored == null) {
            fail(row, -1, "消息内容丢失", null);
            return;
        }
        String touser = str(stored.get("touser"));
        String title = str(stored.get("title"));
        String description = str(stored.get("description"));
        String url = str(stored.get("url"));
        Map<String, Object> payload = api.textcard(touser, title, description, url);
        payload.put("agentid", Integer.valueOf(parseAgent(corp.getAgentId())));

        try {
            String token = tokenService.token(corp);
            WeComApiClient.SendResult result = api.sendMessage(token, payload);
            row.setAttempts(nz(row.getAttempts()) + 1);
            row.setErrcode(Integer.valueOf(result.getErrcode()));
            row.setErrmsg(cut(result.getErrmsg(), 250));
            row.setInvaliduser(cut(result.getInvalidUser(), 900));
            row.setMsgid(cut(result.getMsgId(), 64));
            row.setStatus(result.getInvalidUser() != null ? "partial" : "success");
            /* 无效成员重试也不会变有效：到次数上限就停，避免 partial 永久占队列 */
            row.setNextRetryAt(result.getInvalidUser() != null
                    && nz(row.getAttempts()) < props.getSendMaxAttempts() ? nextRetry(row) : null);
            row.setUpdatedAt(LocalDateTime.now());
            msgMapper.updateResult(row);
        } catch (WeComApiException e) {
            if (e.tokenInvalid()) {
                tokenService.invalidate(corp.getCorpId());
            }
            fail(row, e.getErrcode(), e.getMessage(), null);
        }
    }

    private void fail(WeComMsgLog row, int errcode, String message, String invalidUser) {
        int attempts = nz(row.getAttempts()) + 1;
        row.setAttempts(Integer.valueOf(attempts));
        row.setErrcode(Integer.valueOf(errcode));
        row.setErrmsg(cut(message, 250));
        row.setInvaliduser(cut(invalidUser, 900));
        LocalDateTime retryAt = attempts < props.getSendMaxAttempts() ? nextRetry(row) : null;
        row.setStatus("failed");
        row.setNextRetryAt(retryAt);
        row.setUpdatedAt(LocalDateTime.now());
        msgMapper.updateResult(row);
    }

    private LocalDateTime nextRetry(WeComMsgLog row) {
        int attempts = Math.max(1, nz(row.getAttempts()));
        long delay = (long) props.getSendRetryBackoffSeconds() * attempts;
        return LocalDateTime.now().plusSeconds(Math.max(30, delay));
    }

    private String absoluteUrl(WeComCorp corp, String path) {
        String target = path == null ? "" : path.trim();
        if (target.startsWith("http://") || target.startsWith("https://")) {
            return target;
        }
        if (!target.startsWith("/")) {
            target = "/" + target;
        }
        return corp.getCallbackBaseUrl() + target;
    }

    private String write(Map<String, Object> value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }

    private Map<?, ?> read(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        try {
            return json.readValue(value, LinkedHashMap.class);
        } catch (Exception e) {
            return null;
        }
    }

    private static int parseAgent(String agentId) {
        try {
            return Integer.parseInt(agentId == null ? "0" : agentId.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v.intValue();
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static String cut(String value, int max) {
        if (value == null) {
            return null;
        }
        String s = value.trim();
        return s.length() > max ? s.substring(0, max) : s;
    }
}