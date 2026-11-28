package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ApiTokenAuth;
import com.hourglass.dto.ApiTokenCreateRequest;
import com.hourglass.dto.ApiTokenCreated;
import com.hourglass.dto.ApiTokenView;
import com.hourglass.entity.ApiToken;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.ApiTokenMapper;
import com.hourglass.mapper.UserMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 对外 API 个人访问令牌：签发、列表、撤销与请求期鉴权。
 *
 * <p>令牌只存 SHA-256 哈希；权限上限就是令牌所属账号本人的权限，
 * 不额外扩权。P0 只签发只读令牌，写权限在写接口落地后再放开。
 */
@Service
public class ApiTokenService {

    public static final String SCOPE_READ = "read";
    public static final String SCOPE_WRITE = "write";

    private static final Logger log = LoggerFactory.getLogger(ApiTokenService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    /** 最近使用时间的回写节流：同一令牌 5 分钟内只写一次 */
    private static final long TOUCH_MINUTES = 5L;
    private static final int TOKEN_BYTES = 32;

    private final ApiTokenMapper tokenMapper;
    private final UserMapper userMapper;
    private final SessionEpochService epochs;
    private final PasswordEncoder passwordEncoder;
    private final int defaultDays;

    public ApiTokenService(ApiTokenMapper tokenMapper, UserMapper userMapper, SessionEpochService epochs,
                           PasswordEncoder passwordEncoder,
                           @Value("${app.api.token-days:90}") int defaultDays) {
        this.tokenMapper = tokenMapper;
        this.userMapper = userMapper;
        this.epochs = epochs;
        this.passwordEncoder = passwordEncoder;
        this.defaultDays = defaultDays;
    }

    public ApiTokenCreated create(String userId, ApiTokenCreateRequest req, String ip) {
        AppUser user = userMapper.selectById(userId);
        if (user == null) {
            throw new AppException(401, "未登录或登录已过期");
        }
        String password = Texts.trimToNull(req.getPassword());
        if (password == null || user.getPasswordHash() == null
                || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw AppException.badRequest("当前密码不正确");
        }
        String name = Texts.trimToNull(req.getName());
        if (name == null) {
            throw AppException.badRequest("请填写令牌名称");
        }
        name = Texts.cut(name, 64);

        String scope = Texts.trimToNull(req.getScope());
        if (scope == null) {
            scope = SCOPE_READ;
        }
        if (SCOPE_WRITE.equals(scope)) {
            throw AppException.badRequest("写权限暂未开放，当前只能创建只读令牌");
        }
        if (!SCOPE_READ.equals(scope)) {
            throw AppException.badRequest("令牌类型不合法");
        }

        int days = req.getExpiresInDays() == null ? defaultDays : req.getExpiresInDays();
        if (days < 1 || days > 3650) {
            throw AppException.badRequest("有效期需在 1-3650 天之间");
        }

        String raw = newToken();
        LocalDateTime now = LocalDateTime.now();
        ApiToken token = new ApiToken();
        token.setId(Ids.gen("T"));
        token.setUserId(userId);
        token.setName(name);
        token.setPrefix(raw.substring(0, Math.min(11, raw.length())));
        token.setTokenHash(sha256(raw));
        token.setScope(scope);
        token.setEpoch(epochs.current(userId));
        token.setExpiresAt(now.plusDays(days));
        token.setCreatedAt(now);
        token.setCreatedIp(Texts.cut(ip, 64));
        tokenMapper.insert(token);

        ApiTokenCreated out = new ApiTokenCreated();
        out.setId(token.getId());
        out.setName(token.getName());
        out.setToken(raw);
        out.setPrefix(token.getPrefix());
        out.setScope(token.getScope());
        out.setExpiresAt(token.getExpiresAt());
        return out;
    }

    public List<ApiTokenView> list(String userId) {
        List<ApiTokenView> out = new ArrayList<ApiTokenView>();
        for (ApiToken token : tokenMapper.selectByUser(userId)) {
            out.add(view(token));
        }
        return out;
    }

    /** 管理员排查：全部令牌（可按账号过滤），不返回令牌本身 */
    public List<ApiTokenView> adminList(String userId) {
        List<ApiTokenView> out = new ArrayList<ApiTokenView>();
        for (ApiToken token : tokenMapper.selectAll(Texts.trimToNull(userId))) {
            out.add(view(token));
        }
        return out;
    }

    /** 撤销本人令牌；重复撤销按幂等返回，不报错 */
    public ApiTokenView revoke(String userId, String id) {
        ApiToken token = tokenMapper.selectById(id);
        if (token == null || !userId.equals(token.getUserId())) {
            throw AppException.notFound("令牌不存在");
        }
        if (token.getRevokedAt() == null) {
            tokenMapper.revoke(id, userId, LocalDateTime.now());
        }
        return view(tokenMapper.selectById(id));
    }

    /** 管理员强制撤销：不校验归属，用于处置泄漏；已撤销同样幂等 */
    public ApiTokenView adminRevoke(String id) {
        ApiToken token = tokenMapper.selectById(id);
        if (token == null) {
            throw AppException.notFound("令牌不存在");
        }
        if (token.getRevokedAt() == null) {
            tokenMapper.revokeAny(id, LocalDateTime.now());
        }
        return view(tokenMapper.selectById(id));
    }

    /**
     * 请求期鉴权：哈希查行 → 校验撤销 / 过期 / 账号停用 / 会话代次。
     * 任一不满足返回 null，由过滤器统一回 401。
     */
    public ApiTokenAuth authenticate(String raw) {
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        ApiToken token = tokenMapper.selectByHash(sha256(raw));
        if (token == null || token.getRevokedAt() != null) {
            return null;
        }
        LocalDateTime now = LocalDateTime.now();
        if (token.getExpiresAt() != null && !token.getExpiresAt().isAfter(now)) {
            return null;
        }
        AppUser user = userMapper.selectById(token.getUserId());
        if (user == null || Boolean.TRUE.equals(user.getDisabled())) {
            return null;
        }
        if (token.getEpoch() == null || token.getEpoch().longValue() != epochs.current(user.getId())) {
            return null;
        }
        if (token.getLastUsedAt() == null || token.getLastUsedAt().isBefore(now.minusMinutes(TOUCH_MINUTES))) {
            token.setLastUsedAt(now);
            try {
                tokenMapper.touchLastUsed(token.getId(), now);
            } catch (RuntimeException e) {
                /* 最近使用时间只是观测信息，写失败不影响本次鉴权 */
                log.debug("回写令牌最近使用时间失败：{}", token.getId(), e);
            }
        }
        return new ApiTokenAuth(token, user);
    }

    static ApiTokenView view(ApiToken token) {
        ApiTokenView v = new ApiTokenView();
        v.setId(token.getId());
        v.setName(token.getName());
        v.setPrefix(token.getPrefix());
        v.setScope(token.getScope());
        v.setExpiresAt(token.getExpiresAt());
        v.setLastUsedAt(token.getLastUsedAt());
        v.setRevokedAt(token.getRevokedAt());
        v.setCreatedAt(token.getCreatedAt());
        return v;
    }

    private static String newToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        return "hg_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String sha256(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] out = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(out.length * 2);
            for (byte b : out) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}