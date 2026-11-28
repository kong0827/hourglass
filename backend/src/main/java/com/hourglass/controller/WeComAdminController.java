package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComMsgLog;
import com.hourglass.entity.WeComUserBind;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WeComMsgLogMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import com.hourglass.service.AuditService;
import com.hourglass.wecom.WeComCorpRequest;
import com.hourglass.wecom.WeComCorpService;
import com.hourglass.wecom.WeComTokenService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 平台管理员：登记企业微信企业、启停、查看绑定、代绑定、连通性测试。
 * 只允许平台管理员（/api/admin/** 已由 SecurityConfig 限制角色）。
 */
@RestController
public class WeComAdminController {

    private final WeComCorpService corpService;
    private final WeComTokenService tokenService;
    private final com.hourglass.wecom.WeComBindingService bindingService;
    private final WeComUserBindMapper bindMapper;
    private final WeComMsgLogMapper msgMapper;
    private final UserMapper userMapper;
    private final AuditService audit;

    public WeComAdminController(WeComCorpService corpService, WeComTokenService tokenService,
                                com.hourglass.wecom.WeComBindingService bindingService,
                                WeComUserBindMapper bindMapper, WeComMsgLogMapper msgMapper,
                                UserMapper userMapper, AuditService audit) {
        this.corpService = corpService;
        this.tokenService = tokenService;
        this.bindingService = bindingService;
        this.bindMapper = bindMapper;
        this.msgMapper = msgMapper;
        this.userMapper = userMapper;
        this.audit = audit;
    }

    @GetMapping("/api/admin/wecom/corps")
    public ApiResult<Map<String, Object>> list() {
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (WeComCorp corp : corpService.listAll()) {
            Map<String, Object> item = corpService.mask(corp);
            item.put("bindCount", Integer.valueOf(bindMapper.countByCorp(corp.getCorpId())));
            items.add(item);
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("corps", items);
        return ApiResult.ok(data);
    }

    @PostMapping("/api/admin/wecom/corps")
    public ApiResult<Map<String, Object>> create(@Valid @RequestBody WeComCorpRequest req,
                                                 HttpServletRequest request) {
        WeComCorp corp = corpService.create(CurrentUser.id(), req);
        audit.recordCurrent(null, "wecom.corp.create", "wecom_corp", corp.getId(), corp.getCorpName(),
                true, "登记企业微信企业 " + corp.getCorpId(), request);
        return ApiResult.ok(corpService.mask(corp));
    }

    @PutMapping("/api/admin/wecom/corps/{id}")
    public ApiResult<Map<String, Object>> update(@PathVariable String id,
                                                 @Valid @RequestBody WeComCorpRequest req,
                                                 HttpServletRequest request) {
        WeComCorp corp = corpService.update(id, req);
        tokenService.invalidate(corp.getCorpId());
        audit.recordCurrent(null, "wecom.corp.update", "wecom_corp", id, corp.getCorpName(),
                true, "修改企业微信企业配置", request);
        return ApiResult.ok(corpService.mask(corp));
    }

    @PostMapping("/api/admin/wecom/corps/{id}/status")
    public ApiResult<Map<String, Object>> status(@PathVariable String id,
                                                 @RequestBody Map<String, Object> body,
                                                 HttpServletRequest request) {
        String status = body.get("status") == null ? "" : String.valueOf(body.get("status"));
        corpService.setStatus(id, status);
        WeComCorp corp = corpService.requireCorp(id);
        tokenService.invalidate(corp.getCorpId());
        audit.recordCurrent(null, "wecom.corp.status", "wecom_corp", id, corp.getCorpName(),
                true, "state=" + corp.getStatus(), request);
        return ApiResult.ok(corpService.mask(corp));
    }

    @DeleteMapping("/api/admin/wecom/corps/{id}")
    public ApiResult<Void> delete(@PathVariable String id, HttpServletRequest request) {
        WeComCorp corp = corpService.requireCorp(id);
        corpService.delete(id);
        tokenService.invalidate(corp.getCorpId());
        audit.recordCurrent(null, "wecom.corp.delete", "wecom_corp", id, corp.getCorpName(),
                true, "删除企业微信企业登记", request);
        return ApiResult.ok();
    }

    @PostMapping("/api/admin/wecom/corps/{id}/reset-key")
    public ApiResult<Map<String, Object>> resetKey(@PathVariable String id, HttpServletRequest request) {
        String key = corpService.regenerateKey(id);
        WeComCorp corp = corpService.requireCorp(id);
        audit.recordCurrent(null, "wecom.corp.reset_key", "wecom_corp", id, corp.getCorpName(),
                true, "重置入口短键", request);
        return ApiResult.ok(corpService.mask(corp));
    }

    @GetMapping("/api/admin/wecom/corps/{id}/bindings")
    public ApiResult<Map<String, Object>> bindings(@PathVariable String id) {
        WeComCorp corp = corpService.requireCorp(id);
        List<WeComUserBind> binds = bindMapper.selectByCorp(corp.getCorpId());
        Set<String> userIds = new HashSet<String>();
        for (WeComUserBind bind : binds) {
            userIds.add(bind.getUserId());
        }
        Map<String, AppUser> users = new LinkedHashMap<String, AppUser>();
        if (!userIds.isEmpty()) {
            for (AppUser user : userMapper.selectByIds(new ArrayList<String>(userIds))) {
                users.put(user.getId(), user);
            }
        }
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (WeComUserBind bind : binds) {
            AppUser user = users.get(bind.getUserId());
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", bind.getId());
            item.put("userId", bind.getUserId());
            item.put("username", user == null ? null : user.getUsername());
            item.put("displayName", user == null ? null : user.getDisplayName());
            item.put("wecomUserid", bind.getWecomUserid());
            item.put("status", bind.getStatus());
            item.put("bindSource", bind.getBindSource());
            item.put("boundAt", bind.getBoundAt());
            item.put("lastLoginAt", bind.getLastLoginAt());
            items.add(item);
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("bindings", items);
        return ApiResult.ok(data);
    }

    @PostMapping("/api/admin/wecom/corps/{id}/bindings")
    public ApiResult<Map<String, Object>> bind(@PathVariable String id,
                                               @RequestBody Map<String, Object> body,
                                               HttpServletRequest request) {
        WeComCorp corp = corpService.requireCorp(id);
        String userId = str(body.get("userId"));
        String wecomUserid = str(body.get("wecomUserid"));
        WeComUserBind bind = bindingService.bindByAdmin(userId, corp.getCorpId(),
                wecomUserid, CurrentUser.id());
        audit.recordCurrent(null, "wecom.bind.admin", "wecom_bind", bind.getId(), corp.getCorpName(),
                true, "代绑定 " + userId + " ↔ " + bind.getWecomUserid(), request);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("id", bind.getId());
        data.put("wecomUserid", bind.getWecomUserid());
        return ApiResult.ok(data);
    }

    @DeleteMapping("/api/admin/wecom/bindings/{bindId}")
    public ApiResult<Void> unbind(@PathVariable String bindId, HttpServletRequest request) {
        WeComUserBind bind = bindMapper.selectById(bindId);
        if (bind != null) {
            bindMapper.deleteById(bindId);
            audit.recordCurrent(null, "wecom.bind.delete", "wecom_bind", bindId,
                    bind.getWecomUserid(), true, "管理员解绑", request);
        }
        return ApiResult.ok();
    }

    @PostMapping("/api/admin/wecom/corps/{id}/test")
    public ApiResult<Map<String, Object>> test(@PathVariable String id) {
        WeComCorp corp = corpService.requireCorp(id);
        tokenService.token(corp);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("ok", Boolean.TRUE);
        data.put("corpName", corp.getCorpName());
        return ApiResult.ok(data);
    }

    @GetMapping("/api/admin/wecom/corps/{id}/messages")
    public ApiResult<Map<String, Object>> messages(@PathVariable String id) {
        WeComCorp corp = corpService.requireCorp(id);
        List<WeComMsgLog> rows = msgMapper.selectRecent(null, corp.getCorpId(), 100);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("messages", rows);
        return ApiResult.ok(data);
    }

    private static String str(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}