package com.hourglass.wecom;

import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComCorpSpace;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.WeComCorpMapper;
import com.hourglass.mapper.WeComCorpSpaceMapper;
import com.hourglass.mapper.WeComUserBindMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 企业登记（部署级）与空间授权。
 *
 * <p>一个部署可登记多家企业：每家企业有自己的 CorpID、自建应用与可信域名；
 * 空间按需启用，成员只在本空间启用的企业里做绑定与免登。
 */
@Service
public class WeComCorpService {

    private final WeComCorpMapper corpMapper;
    private final WeComCorpSpaceMapper corpSpaceMapper;
    private final WeComUserBindMapper bindMapper;
    private final WorkspaceMapper workspaceMapper;
    private final AiCrypto crypto;
    private final WeComProperties props;

    public WeComCorpService(WeComCorpMapper corpMapper, WeComCorpSpaceMapper corpSpaceMapper,
                            WeComUserBindMapper bindMapper, WorkspaceMapper workspaceMapper,
                            AiCrypto crypto, WeComProperties props) {
        this.corpMapper = corpMapper;
        this.corpSpaceMapper = corpSpaceMapper;
        this.bindMapper = bindMapper;
        this.workspaceMapper = workspaceMapper;
        this.crypto = crypto;
        this.props = props;
    }

    public List<WeComCorp> listAll() {
        return corpMapper.selectAll();
    }

    public WeComCorp get(String id) {
        return id == null ? null : corpMapper.selectById(id);
    }

    public WeComCorp requireCorp(String id) {
        WeComCorp corp = get(id);
        if (corp == null) {
            throw AppException.notFound("企业不存在");
        }
        return corp;
    }

    public WeComCorp findByKey(String corpKey) {
        String key = corpKey == null ? "" : corpKey.trim();
        return key.isEmpty() ? null : corpMapper.selectByCorpKey(key);
    }

    public WeComCorp requireActive(String id) {
        if (!props.isEnabled()) {
            throw new AppException(400, "企业微信免登未启用");
        }
        WeComCorp corp = requireCorp(id);
        if (!"active".equals(corp.getStatus())) {
            throw new AppException(400, "该企业的企业微信接入已停用");
        }
        return corp;
    }

    public WeComCorp requireActiveByCorpId(String corpId) {
        WeComCorp corp = corpMapper.selectByCorpId(corpId);
        if (corp == null || !"active".equals(corp.getStatus())) {
            throw new AppException(400, "企业微信企业未启用");
        }
        return corp;
    }

    @Transactional
    public WeComCorp create(String operatorId, WeComCorpRequest req) {
        requireSecret(req.getCorpSecret());
        if (corpMapper.selectByCorpId(req.getCorpId().trim()) != null) {
            throw AppException.conflict("该 CorpID 已登记");
        }
        WeComCorp corp = new WeComCorp();
        corp.setId(Ids.gen("WC"));
        corp.setCorpKey(newCorpKey());
        corp.setCorpId(req.getCorpId().trim());
        corp.setCorpName(req.getCorpName().trim());
        corp.setAgentId(req.getAgentId().trim());
        corp.setSecretCipher(crypto.encrypt(req.getCorpSecret().trim()));
        corp.setCallbackBaseUrl(normalizeCallbackBase(req.getCallbackBaseUrl()));
        corp.setAuthMode("self_built");
        corp.setStatus("active");
        corp.setRemark(trimToNull(req.getRemark(), 200));
        corp.setCreatedBy(operatorId);
        corp.setCreatedAt(LocalDateTime.now());
        corp.setUpdatedAt(LocalDateTime.now());
        corpMapper.insert(corp);
        return corp;
    }

    @Transactional
    public WeComCorp update(String id, WeComCorpRequest req) {
        WeComCorp corp = requireCorp(id);
        String corpId = req.getCorpId().trim();
        if (!corpId.equals(corp.getCorpId())) {
            WeComCorp same = corpMapper.selectByCorpId(corpId);
            if (same != null && !same.getId().equals(id)) {
                throw AppException.conflict("该 CorpID 已被其它企业占用");
            }
        }
        corp.setCorpId(corpId);
        corp.setCorpName(req.getCorpName().trim());
        corp.setAgentId(req.getAgentId().trim());
        corp.setCallbackBaseUrl(normalizeCallbackBase(req.getCallbackBaseUrl()));
        corp.setRemark(trimToNull(req.getRemark(), 200));
        if (req.getCorpSecret() != null && !req.getCorpSecret().trim().isEmpty()) {
            corp.setSecretCipher(crypto.encrypt(req.getCorpSecret().trim()));
        }
        corpMapper.update(corp);
        return corp;
    }

    @Transactional
    public void setStatus(String id, String status) {
        String s = "active".equals(status) ? "active" : "disabled";
        requireCorp(id);
        corpMapper.updateStatus(id, s);
    }

    @Transactional
    public void delete(String id) {
        WeComCorp corp = requireCorp(id);
        if (bindMapper.countByCorp(corp.getCorpId()) > 0) {
            throw AppException.conflict("该企业已有成员绑定，请先停用而不是删除");
        }
        corpSpaceMapper.deleteByCorp(corp.getCorpId());
        corpMapper.deleteById(id);
    }

    public String regenerateKey(String id) {
        WeComCorp corp = requireCorp(id);
        String key = newCorpKey();
        corp.setCorpKey(key);
        corpMapper.update(corp);
        return key;
    }

    /** 空间启用的企业（只返回已启用的）；停用的仍列出并标记，便于空间主知道要重新启用 */
    public List<WeComCorp> listForWorkspace(String workspaceId) {
        List<String> corpIds = corpSpaceMapper.selectCorpIdsByWorkspace(workspaceId);
        if (corpIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<WeComCorp> result = new ArrayList<WeComCorp>();
        for (String corpId : corpIds) {
            WeComCorp corp = corpMapper.selectByCorpId(corpId);
            if (corp != null) {
                result.add(corp);
            }
        }
        return result;
    }

    /** @param corpId 企业真实 CorpID（跨表统一口径） */
    public Set<String> enabledCorpIds(String workspaceId) {
        Set<String> enabled = new LinkedHashSet<String>();
        for (WeComCorp corp : listForWorkspace(workspaceId)) {
            if ("active".equals(corp.getStatus())) {
                enabled.add(corp.getCorpId());
            }
        }
        return enabled;
    }

    /** @param corpId 企业真实 CorpID */
    public boolean enabledForWorkspace(String workspaceId, String corpId) {
        return corpId != null && corpSpaceMapper.selectCorpIdsByWorkspace(workspaceId).contains(corpId);
    }

    /** 入参是接入配置的 ID；落库统一为真实 CorpID */
    @Transactional
    public void setWorkspaceCorps(String workspaceId, String operatorId, List<String> corpIds) {
        List<String> wanted = new ArrayList<String>();
        if (corpIds != null) {
            for (String id : corpIds) {
                if (id == null || id.trim().isEmpty()) {
                    continue;
                }
                WeComCorp corp = requireCorp(id.trim());
                if (!"active".equals(corp.getStatus())) {
                    throw AppException.badRequest("企业「" + corp.getCorpName() + "」已停用，不能启用");
                }
                if (!wanted.contains(corp.getCorpId())) {
                    wanted.add(corp.getCorpId());
                }
            }
        }
        List<String> current = corpSpaceMapper.selectCorpIdsByWorkspace(workspaceId);
        for (String corpId : current) {
            if (!wanted.contains(corpId)) {
                corpSpaceMapper.delete(workspaceId, corpId);
            }
        }
        for (String corpId : wanted) {
            if (!current.contains(corpId)) {
                WeComCorpSpace row = new WeComCorpSpace();
                row.setWorkspaceId(workspaceId);
                row.setCorpId(corpId);
                row.setCreatedBy(operatorId);
                row.setCreatedAt(LocalDateTime.now());
                corpSpaceMapper.insert(row);
            }
        }
    }

    /** 当前账号至少在一个启用该企业（真实 CorpID）的空间里（绑定入口的前置校验） */
    public boolean availableToUser(String corpId, String userId) {
        for (Workspace ws : workspaceMapper.selectByUser(userId)) {
            if (enabledForWorkspace(ws.getId(), corpId)) {
                return true;
            }
        }
        return false;
    }

    /** 当前账号可选的启用企业（按空间去重） */
    public List<WeComCorp> availableToUser(String userId) {
        Map<String, WeComCorp> seen = new LinkedHashMap<String, WeComCorp>();
        for (Workspace ws : workspaceMapper.selectByUser(userId)) {
            for (WeComCorp corp : listForWorkspace(ws.getId())) {
                if ("active".equals(corp.getStatus()) && !seen.containsKey(corp.getId())) {
                    seen.put(corp.getId(), corp);
                }
            }
        }
        return new ArrayList<WeComCorp>(seen.values());
    }

    /** 传给前端的字段：Secret 只给掩码，绝不回传密文 */
    public Map<String, Object> mask(WeComCorp corp) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("id", corp.getId());
        m.put("corpKey", corp.getCorpKey());
        m.put("corpId", corp.getCorpId());
        m.put("corpName", corp.getCorpName());
        m.put("agentId", corp.getAgentId());
        m.put("callbackBaseUrl", corp.getCallbackBaseUrl());
        m.put("callbackUrl", corp.getCallbackBaseUrl() + "/wecom/callback");
        m.put("authMode", corp.getAuthMode());
        m.put("status", corp.getStatus());
        m.put("remark", corp.getRemark());
        m.put("hasSecret", corp.getSecretCipher() != null && !corp.getSecretCipher().isEmpty());
        m.put("secretMask", corp.getSecretCipher() == null ? null : "******");
        m.put("createdAt", corp.getCreatedAt());
        m.put("updatedAt", corp.getUpdatedAt());
        return m;
    }

    public String secretOf(WeComCorp corp) {
        String secret = crypto.decrypt(corp.getSecretCipher());
        if (secret == null || secret.trim().isEmpty()) {
            throw new AppException(400, "应用 Secret 解密失败，请在企业管理里重新填写");
        }
        return secret;
    }

    public String entryPath(WeComCorp corp) {
        return "/wecom/entry?c=" + corp.getCorpKey();
    }

    private void requireSecret(String secret) {
        if (secret == null || secret.trim().isEmpty()) {
            throw AppException.badRequest("请填写应用 Secret");
        }
    }

    private String newCorpKey() {
        return Ids.genToken().substring(0, 16).toLowerCase(Locale.ROOT);
    }

    /** 回调根地址：只允许 http(s)://host[:port]/path，不能带查询串，末尾不留斜杠 */
    private String normalizeCallbackBase(String raw) {
        String value = raw == null ? "" : raw.trim();
        URI uri;
        try {
            uri = URI.create(value);
        } catch (Exception e) {
            throw AppException.badRequest("回调根地址格式不正确");
        }
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) {
            throw AppException.badRequest("回调根地址必须以 https:// 或 http:// 开头");
        }
        if (uri.getHost() == null || uri.getHost().isEmpty()) {
            throw AppException.badRequest("回调根地址缺少域名");
        }
        if (uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw AppException.badRequest("回调根地址不能带查询串或锚点");
        }
        if (!props.hostAllowed(uri.getHost())) {
            throw AppException.badRequest("回调根地址不在允许的域名白名单内（app.wecom.allowed-callback-hosts）");
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        while (path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        int port = uri.getPort();
        return scheme.toLowerCase(Locale.ROOT) + "://" + uri.getHost().toLowerCase(Locale.ROOT)
                + (port > 0 ? ":" + port : "") + path;
    }

    private static String trimToNull(String value, int max) {
        String s = value == null ? null : value.trim();
        if (s == null || s.isEmpty()) {
            return null;
        }
        return s.length() > max ? s.substring(0, max) : s;
    }
}