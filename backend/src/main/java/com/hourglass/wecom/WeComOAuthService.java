package com.hourglass.wecom;

import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComOauthState;
import com.hourglass.entity.WeComUserBind;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;

/**
 * 企微 OAuth 入口与回调。
 *
 * <p>每家企业的自建应用有自己的可信域名与回调地址，所以入口必须带企业上下文（corpKey）；
 * state 里再固化一次企业，回调时不再依赖域名或 Cookie 猜是哪一家。
 */
@Service
public class WeComOAuthService {

    private static final Logger log = LoggerFactory.getLogger(WeComOAuthService.class);
    private static final String AUTHORIZE = "https://open.weixin.qq.com/connect/oauth2/authorize";

    private final WeComProperties props;
    private final WeComCorpService corpService;
    private final WeComStateService stateService;
    private final WeComApiClient api;
    private final WeComTokenService tokens;
    private final WeComBindingService bindings;
    private final WeComSessionService sessionService;

    public WeComOAuthService(WeComProperties props, WeComCorpService corpService,
                             WeComStateService stateService, WeComApiClient api,
                             WeComTokenService tokens, WeComBindingService bindings,
                             WeComSessionService sessionService) {
        this.props = props;
        this.corpService = corpService;
        this.stateService = stateService;
        this.api = api;
        this.tokens = tokens;
        this.bindings = bindings;
        this.sessionService = sessionService;
    }

    public String authorizeUrl(WeComCorp corp, String state) {
        String callback = corp.getCallbackBaseUrl() + "/wecom/callback";
        return AUTHORIZE
                + "?appid=" + enc(corp.getCorpId())
                + "&redirect_uri=" + enc(callback)
                + "&response_type=code&scope=snsapi_base"
                + "&state=" + enc(state)
                + "&agentid=" + enc(corp.getAgentId())
                + "#wechat_redirect";
    }

    /** 登录入口：未带企业时交给前端选择器；绑定入口要求已登录且在同一企业可用的空间里 */
    public void entry(String corpKey, String target, boolean bind,
                      HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (!props.isEnabled()) {
            redirect(resp, loginUrl(req, "reason=wecom_disabled", null));
            return;
        }
        final String safeTarget = WeComSafePath.of(target, "/");
        WeComCorp corp = corpService.findByKey(corpKey);
        if (corp == null || !"active".equals(corp.getStatus())) {
            redirect(resp, loginUrl(req, "reason=wecom_disabled", null));
            return;
        }
        String userId = CurrentUser.idOrNull();
        if (bind) {
            if (userId == null) {
                redirect(resp, loginUrl(req, null, safeTarget));
                return;
            }
            if (!corpService.availableToUser(corp.getCorpId(), userId)) {
                redirect(resp, loginUrl(req, "reason=wecom_scope", safeTarget));
                return;
            }
        }
        String state = stateService.issue(bind ? "bind" : "login", corp.getCorpId(),
                bind ? userId : null, safeTarget, null,
                com.hourglass.service.AuditService.clientIp(req));
        redirect(resp, authorizeUrl(corp, state));
    }

    public void callback(String code, String state, HttpServletRequest req,
                         HttpServletResponse resp) throws IOException {
        WeComOauthState st = stateService.consume(state);
        if (st == null) {
            /* state 过期或已用（刷新回调页）：回到登录页，不重复换码 */
            redirect(resp, loginUrl(req, "reason=wecom_state", null));
            return;
        }
        WeComCorp corp;
        try {
            corp = corpService.requireActiveByCorpId(st.getCorpId());
        } catch (AppException e) {
            redirect(resp, loginUrl(req, "reason=wecom_disabled", null));
            return;
        }
        String safeTarget = WeComSafePath.of(st.getTarget(), "/");
        if (code == null || code.trim().isEmpty()) {
            redirect(resp, loginUrl(req, "reason=wecom_denied", safeTarget));
            return;
        }
        WeComApiClient.UserInfo info;
        try {
            String token = tokens.token(corp);
            info = api.getUserByCode(token, code.trim());
        } catch (WeComApiException e) {
            if (e.tokenInvalid()) {
                tokens.invalidate(corp.getCorpId());
            }
            log.warn("企微回调换取成员失败（corp={}）：{}", corp.getCorpName(), e.getMessage());
            redirect(resp, loginUrl(req, "reason=wecom_api", safeTarget));
            return;
        }
        String wecomUserId = info.effectiveUserId();
        if (wecomUserId == null) {
            redirect(resp, loginUrl(req, "reason=wecom_not_member", safeTarget));
            return;
        }

        if ("bind".equals(st.getPurpose())) {
            String current = sessionService.currentUserId();
            if (current == null || !current.equals(st.getUserId())) {
                redirect(resp, loginUrl(req, "reason=wecom_bind_session", safeTarget));
                return;
            }
            try {
                bindings.bindSelf(current, corp.getCorpId(), wecomUserId);
            } catch (AppException e) {
                redirect(resp, loginUrl(req, "reason=wecom_bind_conflict", safeTarget));
                return;
            }
            redirect(resp, targetUrl(req, safeTarget));
            return;
        }

        WeComUserBind bind = bindings.findActive(corp.getCorpId(), wecomUserId);
        if (bind == null) {
            /* 不凭企微身份认领本地账号：先密码登录，再到个人设置里绑定 */
            redirect(resp, loginUrl(req, "wecomUnbound=1", safeTarget));
            return;
        }
        AppUser user;
        try {
            user = sessionService.requireEnabled(bind.getUserId());
        } catch (AppException e) {
            redirect(resp, loginUrl(req, "reason=account_disabled", safeTarget));
            return;
        }
        sessionService.login(req, resp, user, corp, bind);
        redirect(resp, targetUrl(req, safeTarget));
    }

    /** state 里存的是站内路径（不含 context-path）；回落时补上再跳 */
    private static String targetUrl(HttpServletRequest req, String target) {
        String ctx = req.getContextPath();
        if (ctx == null || ctx.isEmpty()) {
            return target;
        }
        return target.startsWith(ctx + "/") || target.equals(ctx) ? target : ctx + target;
    }

    private String loginUrl(HttpServletRequest req, String flag, String next) {
        StringBuilder sb = new StringBuilder(req.getContextPath()).append(props.getLoginPage());
        sb.append('?');
        if (flag != null && !flag.isEmpty()) {
            sb.append(flag);
        }
        if (next != null) {
            if (sb.charAt(sb.length() - 1) != '?') {
                sb.append('&');
            }
            sb.append("next=").append(enc(next));
        }
        String url = sb.toString();
        return url.endsWith("?") ? url.substring(0, url.length() - 1) : url;
    }

    private static void redirect(HttpServletResponse resp, String location) throws IOException {
        resp.setStatus(HttpServletResponse.SC_FOUND);
        resp.setHeader("Location", location);
    }

    private static String enc(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}