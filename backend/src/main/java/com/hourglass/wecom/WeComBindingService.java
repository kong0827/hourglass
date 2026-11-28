package com.hourglass.wecom;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 本地账号 ↔ 企微成员绑定。
 *
 * <p>唯一键 (corp_id, wecom_userid)：同一个人可以在甲方与供应商各绑一条；
 * 同一企业里一个企微账号只能对应一个本地账号，避免串号。
 * 未绑定的人不会被企微身份自动认领——先密码登录，再在个人设置里绑定。
 */
@Service
public class WeComBindingService {

    private static final Pattern USERID = Pattern.compile("^[A-Za-z0-9_.@\\-]{1,64}$");

    private final WeComUserBindMapper mapper;
    private final WeComCorpService corpService;
    private final UserMapper userMapper;

    public WeComBindingService(WeComUserBindMapper mapper, WeComCorpService corpService, UserMapper userMapper) {
        this.mapper = mapper;
        this.corpService = corpService;
        this.userMapper = userMapper;
    }

    public WeComUserBind findActive(String corpId, String wecomUserid) {
        String uid = normalize(wecomUserid);
        if (uid == null) {
            return null;
        }
        WeComUserBind bind = mapper.selectByCorpUserid(corpId, uid);
        return bind != null && "active".equals(bind.getStatus()) ? bind : null;
    }

    public List<WeComUserBind> listForUser(String userId) {
        return mapper.selectByUser(userId);
    }

    public List<WeComUserBind> listForCorp(String corpId) {
        return mapper.selectByCorp(corpId);
    }

    /** 本人发起绑定：必须已登录，且与企微身份同属一个启用了该企业的空间 */
    @Transactional
    public WeComUserBind bindSelf(String userId, String corpId, String wecomUserid) {
        return bind(userId, corpId, wecomUserid, "self", userId);
    }

    @Transactional
    public WeComUserBind bindByAdmin(String userId, String corpId, String wecomUserid, String operatorId) {
        return bind(userId, corpId, wecomUserid, "admin", operatorId);
    }

    private WeComUserBind bind(String userId, String corpId, String rawWecomUserid,
                               String source, String boundBy) {
        String wecomUserid = normalize(rawWecomUserid);
        if (wecomUserid == null) {
            throw AppException.badRequest("企微成员账号格式不正确");
        }
        AppUser user = userMapper.selectById(userId);
        if (user == null) {
            throw AppException.notFound("账号不存在");
        }
        if (Boolean.TRUE.equals(user.getDisabled())) {
            throw AppException.badRequest("该账号已停用，不能绑定企业微信");
        }
        if (!corpService.availableToUser(corpId, userId)) {
            throw new AppException(403, "你不在启用该企业的空间里，不能绑定");
        }
        WeComUserBind byWecom = mapper.selectByCorpUserid(corpId, wecomUserid);
        if (byWecom != null && !userId.equals(byWecom.getUserId())) {
            throw AppException.conflict("该企微账号已绑定到其他成员，请联系管理员解绑");
        }
        WeComUserBind byUser = mapper.selectByUserAndCorp(userId, corpId);
        if (byUser != null && !wecomUserid.equals(byUser.getWecomUserid())) {
            throw AppException.conflict("你已绑定该企业的另一个企微账号，请先解绑");
        }
        LocalDateTime now = LocalDateTime.now();
        if (byUser != null) {
            /* 同企业同账号重复绑定：幂等；曾停用的重新激活 */
            if (!"active".equals(byUser.getStatus())) {
                mapper.updateStatus(byUser.getId(), "active", boundBy);
                byUser.setStatus("active");
                byUser.setBoundBy(boundBy);
                byUser.setBoundAt(now);
            }
            return byUser;
        }
        WeComUserBind bind = new WeComUserBind();
        bind.setId(Ids.gen("WB"));
        bind.setUserId(userId);
        bind.setCorpId(corpId);
        bind.setWecomUserid(wecomUserid);
        bind.setBindSource(source);
        bind.setStatus("active");
        bind.setBoundBy(boundBy);
        bind.setBoundAt(now);
        mapper.insert(bind);
        return bind;
    }

    @Transactional
    public void unbindSelf(String userId, String corpId) {
        WeComUserBind bind = mapper.selectByUserAndCorp(userId, corpId);
        if (bind == null) {
            return;
        }
        mapper.deleteById(bind.getId());
    }

    @Transactional
    public void unbindById(String bindId) {
        mapper.deleteById(bindId);
    }

    public void markLogin(WeComUserBind bind) {
        try {
            mapper.updateLastLogin(bind.getId(), LocalDateTime.now());
        } catch (Exception ignored) {
            /* 登录成功不应因为时间戳失败而回滚 */
        }
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toLowerCase(Locale.ROOT);
        return USERID.matcher(v).matches() ? v : null;
    }
}