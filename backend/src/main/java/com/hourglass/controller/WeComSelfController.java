package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.service.AuditService;
import com.hourglass.wecom.WeComBindingService;
import com.hourglass.wecom.WeComCorpService;
import com.hourglass.wecom.WeComOAuthService;
import com.hourglass.wecom.WeComSafePath;
import com.hourglass.wecom.WeComStateService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 个人设置 → 企业微信：查看本人绑定、发起绑定、按企业解绑。
 * 绑定必须由已登录的本人发起；同一人可在多家企业各绑一条。
 */
@RestController
public class WeComSelfController {

    private final WeComCorpService corpService;
    private final WeComBindingService bindingService;
    private final WeComStateService stateService;
    private final WeComOAuthService oauth;
    private final AuditService audit;

    public WeComSelfController(WeComCorpService corpService, WeComBindingService bindingService,
                               WeComStateService stateService, WeComOAuthService oauth,
                               AuditService audit) {
        this.corpService = corpService;
        this.bindingService = bindingService;
        this.stateService = stateService;
        this.oauth = oauth;
        this.audit = audit;
    }

    @GetMapping("/api/wecom/me")
    public ApiResult<Map<String, Object>> me() {
        String userId = CurrentUser.id();
        List<Map<String, Object>> binds = new ArrayList<Map<String, Object>>();
        for (WeComUserBind bind : bindingService.listForUser(userId)) {
            WeComCorp corp = corpOf(bind.getCorpId());
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", bind.getId());
            item.put("corpId", bind.getCorpId());
            item.put("corpName", corp == null ? bind.getCorpId() : corp.getCorpName());
            item.put("wecomUserid", bind.getWecomUserid());
            item.put("status", bind.getStatus());
            item.put("bindSource", bind.getBindSource());
            item.put("boundAt", bind.getBoundAt());
            item.put("lastLoginAt", bind.getLastLoginAt());
            binds.add(item);
        }
        List<Map<String, Object>> available = new ArrayList<Map<String, Object>>();
        for (WeComCorp corp : corpService.availableToUser(userId)) {
            available.add(entryView(corp));
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("bindings", binds);
        data.put("availableCorps", available);
        return ApiResult.ok(data);
    }

    /** 发起绑定：返回企微授权地址，前端整页跳转（不要在 iframe 里打开） */
    @PostMapping("/api/wecom/bind/start")
    public ApiResult<Map<String, Object>> start(@RequestBody Map<String, Object> body,
                                                HttpServletRequest request) {
        String userId = CurrentUser.id();
        String corpConfigId = str(body.get("corpId"));
        WeComCorp corp = corpService.requireCorp(corpConfigId);
        String target = WeComSafePath.of(str(body.get("target")), "/");
        if (!corpService.availableToUser(corp.getCorpId(), userId)) {
            throw new com.hourglass.common.AppException(403, "你不在启用该企业的空间里，不能绑定");
        }
        String state = stateService.issue("bind", corp.getCorpId(), userId, target, null,
                AuditService.clientIp(request));
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("authorizeUrl", oauth.authorizeUrl(corp, state));
        return ApiResult.ok(data);
    }

    @DeleteMapping("/api/wecom/bind/{corpId}")
    public ApiResult<Void> unbind(@PathVariable String corpId, HttpServletRequest request) {
        String userId = CurrentUser.id();
        WeComCorp corp = corpOf(corpId);
        String corpName = corp == null ? corpId : corp.getCorpName();
        bindingService.unbindSelf(userId, corpId);
        audit.recordCurrent(null, "wecom.unbind", "wecom_bind", corpId, corpName,
                true, "解绑企业微信（" + corpName + "）", request);
        return ApiResult.ok();
    }

    private WeComCorp corpOf(String corpId) {
        for (WeComCorp corp : corpService.listAll()) {
            if (corp.getCorpId().equals(corpId)) {
                return corp;
            }
        }
        return null;
    }

    private Map<String, Object> entryView(WeComCorp corp) {
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("id", corp.getId());
        item.put("corpId", corp.getCorpId());
        item.put("corpName", corp.getCorpName());
        item.put("entryPath", corpService.entryPath(corp));
        return item;
    }

    private static String str(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}