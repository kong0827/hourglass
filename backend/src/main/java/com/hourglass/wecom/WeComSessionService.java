package com.hourglass.wecom;

import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.LoginUser;
import com.hourglass.config.SessionEpochFilter;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.AuditService;
import com.hourglass.service.SessionEpochService;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

/**
 * 企微回调成功后建立与密码登录一致的会话：
 * 容器 HttpSession + Spring Security 主体 + 会话代次，不引入 JWT 或独立 SID。
 */
@Service
public class WeComSessionService {

    private final UserMapper userMapper;
    private final SessionEpochService epochs;
    private final AuditService audit;
    private final WeComBindingService bindings;
    private final HttpSessionSecurityContextRepository repository = new HttpSessionSecurityContextRepository();

    public WeComSessionService(UserMapper userMapper, SessionEpochService epochs,
                               AuditService audit, WeComBindingService bindings) {
        this.userMapper = userMapper;
        this.epochs = epochs;
        this.audit = audit;
        this.bindings = bindings;
    }

    public AppUser requireEnabled(String userId) {
        AppUser user = userMapper.selectById(userId);
        if (user == null) {
            throw AppException.notFound("账号不存在");
        }
        if (Boolean.TRUE.equals(user.getDisabled())) {
            throw new AppException(403, "该账号已被停用，请联系管理员");
        }
        return user;
    }

    public String currentUserId() {
        return CurrentUser.idOrNull();
    }

    /** 免登：会话固定防护使用 Servlet 3.1 的 changeSessionId，保留原会话里的其它属性 */
    public void login(HttpServletRequest req, HttpServletResponse resp, AppUser user,
                      WeComCorp corp, WeComUserBind bind) {
        HttpSession session = req.getSession(true);
        try {
            req.changeSessionId();
        } catch (IllegalStateException ignored) {
            /* 容器不支持时退化为新会话 */
        }
        LoginUser principal = new LoginUser(user.getId(), user.getUsername(), user.getPasswordHash(),
                user.getDisplayName(), user.getRole(), true);
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                principal, null, principal.getAuthorities());
        auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(req));
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        session.setAttribute(SessionEpochFilter.SESSION_KEY, epochs.current(user.getId()));
        repository.saveContext(context, req, resp);
        bindings.markLogin(bind);
        audit.recordLogin(principal, user.getUsername(), true,
                "企业微信免登（" + corp.getCorpName() + "）", req);
    }
}