package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.entity.WeComCorp;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.wecom.WeComOAuthService;
import com.hourglass.wecom.WeComProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 企微免登的公开入口与回调（不走 /api，也不需要 CSRF）。
 * 回调凭 state 定位企业，任何部署级 Secret 都不出现在 URL 或前端。
 */
@RestController
public class WeComOAuthController {

    private final WeComOAuthService oauth;
    private final WeComCorpMapper corpMapper;
    private final WeComProperties props;

    public WeComOAuthController(WeComOAuthService oauth, WeComCorpMapper corpMapper,
                                WeComProperties props) {
        this.oauth = oauth;
        this.corpMapper = corpMapper;
        this.props = props;
    }

    /** 登录页的企业选择器：只列至少被一个空间启用的企业 */
    @GetMapping("/wecom/corps")
    public ApiResult<Map<String, Object>> corps() {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        List<Map<String, Object>> list = new ArrayList<Map<String, Object>>();
        if (props.isEnabled()) {
            for (WeComCorp corp : corpMapper.selectActiveRegistered()) {
                Map<String, Object> item = new LinkedHashMap<String, Object>();
                item.put("corpKey", corp.getCorpKey());
                item.put("corpName", corp.getCorpName());
                list.add(item);
            }
        }
        data.put("enabled", Boolean.valueOf(props.isEnabled()));
        data.put("corps", list);
        return ApiResult.ok(data);
    }

    /**
     * @param c      企业入口短键（登录页选择器给出）
     * @param target 回调后的站内路径
     * @param bind   1=个人设置里发起绑定（要求已登录）
     */
    @GetMapping("/wecom/entry")
    public void entry(@RequestParam(value = "c", required = false) String corpKey,
                      @RequestParam(value = "target", required = false) String target,
                      @RequestParam(value = "bind", required = false) String bind,
                      HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (corpKey == null || corpKey.trim().isEmpty()) {
            resp.sendRedirect(req.getContextPath() + props.getLoginPage() + "?reason=wecom_need_corp");
            return;
        }
        oauth.entry(corpKey, target, "1".equals(bind), req, resp);
    }

    @GetMapping("/wecom/callback")
    public void callback(@RequestParam(value = "code", required = false) String code,
                         @RequestParam(value = "state", required = false) String state,
                         HttpServletRequest req, HttpServletResponse resp) throws IOException {
        oauth.callback(code, state, req, resp);
    }
}