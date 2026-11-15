package com.hourglass.service;

import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.common.Webhooks;
import com.hourglass.dto.RepoSaveRequest;
import com.hourglass.entity.ProjectRepo;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectRepoMapper;
import com.hourglass.mapper.RequirementMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 项目仓库绑定：读写都只面向仓库配置，同步逻辑在 {@link GitSyncService}。
 *
 * <p>令牌只在保存时加密入库，对外响应一律清空密文、只给 {@code tokenConfigured} 布尔值。
 * 仓库地址与推送地址同口径做 SSRF 校验；内网自建 GitLab 需显式开启
 * {@code app.git.allow-private}。
 */
@Service
public class RepoService {

    private final ProjectRepoMapper repoMapper;
    private final DevBranchMapper branchMapper;
    private final RequirementMapper requirementMapper;
    private final ProjectAccessService projectAccess;
    private final AiCrypto aiCrypto;
    private final boolean allowPrivate;

    public RepoService(ProjectRepoMapper repoMapper, DevBranchMapper branchMapper,
                       RequirementMapper requirementMapper, ProjectAccessService projectAccess,
                       AiCrypto aiCrypto, @Value("${app.git.allow-private:false}") boolean allowPrivate) {
        this.repoMapper = repoMapper;
        this.branchMapper = branchMapper;
        this.requirementMapper = requirementMapper;
        this.projectAccess = projectAccess;
        this.aiCrypto = aiCrypto;
        this.allowPrivate = allowPrivate;
    }

    public List<ProjectRepo> list(String workspaceId, String userId) {
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        List<ProjectRepo> repos = repoMapper.selectVisible(workspaceId, viewerId);
        fillBranchCounts(workspaceId, repos);
        for (ProjectRepo repo : repos) {
            publicView(repo);
        }
        return repos;
    }

    public ProjectRepo get(String workspaceId, String id) {
        ProjectRepo repo = repoMapper.selectById(id);
        if (repo == null || !workspaceId.equals(repo.getWorkspaceId())) {
            throw AppException.notFound("仓库绑定不存在：" + id);
        }
        return repo;
    }

    public ProjectRepo getPublic(String workspaceId, String userId, String id) {
        ProjectRepo repo = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, repo.getReqId());
        fillBranchCounts(workspaceId, java.util.Collections.singletonList(repo));
        return publicView(repo);
    }

    /** 仓库列表与详情要显示「进行中 / 待确认」：一次按仓库×生命周期汇总，避免每个仓库各查一次 */
    private void fillBranchCounts(String workspaceId, List<ProjectRepo> repos) {
        if (repos.isEmpty()) {
            return;
        }
        Map<String, ProjectRepo> byId = new HashMap<String, ProjectRepo>();
        for (ProjectRepo repo : repos) {
            repo.setOpenBranchCount(0);
            repo.setPendingBranchCount(0);
            byId.put(repo.getId(), repo);
        }
        for (Map<String, Object> row : branchMapper.countRepoOutcomes(workspaceId)) {
            Object repoId = row.get("repoId");
            ProjectRepo repo = repoId == null ? null : byId.get(String.valueOf(repoId));
            if (repo == null) {
                continue;
            }
            /* outcome 为空是生命周期字段上线前的老数据，按进行中算 */
            String outcome = row.get("outcome") == null ? "open" : String.valueOf(row.get("outcome"));
            int cnt = ((Number) row.get("cnt")).intValue();
            if ("open".equals(outcome)) {
                repo.setOpenBranchCount(repo.getOpenBranchCount() + cnt);
            } else if ("pending".equals(outcome)) {
                repo.setPendingBranchCount(repo.getPendingBranchCount() + cnt);
            }
        }
    }

    @Transactional
    public ProjectRepo create(String userId, String workspaceId, RepoSaveRequest req) {
        ProjectRepo repo = new ProjectRepo();
        repo.setId(Ids.gen("R"));
        repo.setWorkspaceId(workspaceId);
        repo.setCreatedBy(userId);
        apply(repo, workspaceId, req, true);
        try {
            repoMapper.insert(repo);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw AppException.badRequest("同一空间已绑定该项目（地址 + 项目标识）："
                    + repo.getRepoUrl() + " / " + repo.getProjectRef());
        }
        return publicView(repoMapper.selectById(repo.getId()));
    }

    @Transactional
    public ProjectRepo update(String userId, String workspaceId, String id, RepoSaveRequest req) {
        ProjectRepo repo = get(workspaceId, id);
        boolean hasBranches = !branchMapper.selectByRepo(workspaceId, id).isEmpty();
        if (Texts.trimToNull(req.getReqId()) != null
                && !repo.getReqId().equals(req.getReqId().trim())
                && hasBranches) {
            /* 已跟踪分支的 req_id 来自旧项目；换项目会让「谁的仓库分支」彻底错位 */
            throw AppException.badRequest("该仓库已有同步分支，不能更换所属项目；请先解绑仓库");
        }
        String oldUrl = Texts.trimToNull(repo.getRepoUrl());
        String oldRef = Texts.trimToNull(repo.getProjectRef());
        apply(repo, workspaceId, req, false);
        if (hasBranches && (!Objects.equals(oldUrl, Texts.trimToNull(repo.getRepoUrl()))
                || !Objects.equals(oldRef, Texts.trimToNull(repo.getProjectRef())))) {
            /* 换地址或项目标识等于换一个远程仓库：已有分支的 SHA/合并事实会张冠李戴 */
            throw AppException.badRequest("该仓库已有同步分支，不能更换 GitLab 地址或项目标识；请先解绑仓库");
        }
        try {
            repoMapper.update(repo);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw AppException.badRequest("同一空间已绑定该项目（地址 + 项目标识）："
                    + repo.getRepoUrl() + " / " + repo.getProjectRef());
        }
        return publicView(repoMapper.selectById(id));
    }

    @Transactional
    public ProjectRepo setEnabled(String userId, String workspaceId, String id, boolean enabled) {
        get(workspaceId, id);
        repoMapper.updateEnabled(workspaceId, id, enabled);
        return publicView(repoMapper.selectById(id));
    }

    @Transactional
    public void deleteByReq(String workspaceId, String reqId) {
        repoMapper.deleteByReq(workspaceId, reqId);
    }

    /** 同步用明文令牌；密文解不开时明确要求重填，绝不把密文当令牌发出去 */
    public String tokenOf(ProjectRepo repo) {
        String cipher = Texts.trimToNull(repo.getTokenCipher());
        if (cipher == null) {
            return null;
        }
        String plain = aiCrypto.decrypt(cipher);
        if (plain == null) {
            throw AppException.badRequest("访问令牌无法解密（加密密钥可能已更换），请重新填写");
        }
        return plain;
    }

    /** 对外视图：清空密文，只保留「是否已配置」 */
    public ProjectRepo publicView(ProjectRepo repo) {
        if (repo == null) {
            return null;
        }
        repo.setTokenConfigured(Texts.trimToNull(repo.getTokenCipher()) != null);
        repo.setTokenCipher(null);
        return repo;
    }

    private void apply(ProjectRepo repo, String workspaceId, RepoSaveRequest req, boolean creating) {
        String reqId = Texts.trimToNull(req.getReqId());
        if (creating && reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        if (reqId != null) {
            Requirement r = requirementMapper.selectById(reqId);
            if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
                throw AppException.badRequest("所属项目不存在：" + reqId);
            }
            repo.setReqId(reqId);
        }
        String repoUrl = normalizeUrl(req.getRepoUrl(), creating);
        if (repoUrl != null) {
            repo.setRepoUrl(repoUrl);
        }
        String projectRef = Texts.trimToNull(req.getProjectRef());
        if (projectRef != null) {
            while (projectRef.startsWith("/")) {
                projectRef = projectRef.substring(1);
            }
            while (projectRef.endsWith("/")) {
                projectRef = projectRef.substring(0, projectRef.length() - 1);
            }
            if (projectRef.isEmpty()) {
                throw AppException.badRequest("请填写 GitLab 项目标识（数字 ID 或 group/project）");
            }
            repo.setProjectRef(projectRef);
        } else if (creating) {
            throw AppException.badRequest("请填写 GitLab 项目标识（数字 ID 或 group/project）");
        }
        /* repo_url 只是 GitLab 站点，站点下可以有多个仓库，唯一性必须带 project_ref */
        String uniqueUrl = Texts.trimToNull(repo.getRepoUrl());
        String uniqueRef = Texts.trimToNull(repo.getProjectRef());
        if (uniqueUrl != null && uniqueRef != null) {
            ProjectRepo same = repoMapper.selectByWorkspaceAndUrl(workspaceId, uniqueUrl, uniqueRef);
            if (same != null && !same.getId().equals(repo.getId())) {
                throw AppException.badRequest("同一空间已绑定该项目（地址 + 项目标识）："
                        + uniqueUrl + " / " + uniqueRef);
            }
        }
        String policy = Texts.trimToNull(req.getImportPolicy());
        if (policy != null) {
            if (!"recent90".equals(policy) && !"all".equals(policy) && !"manual".equals(policy)) {
                throw AppException.badRequest("导入策略只能是 recent90 / all / manual");
            }
            repo.setImportPolicy(policy);
        } else if (creating) {
            repo.setImportPolicy("recent90");
        }
        if (req.getName() != null) {
            repo.setName(Texts.cut(Texts.trimToNull(req.getName()), 80));
        } else if (creating) {
            repo.setName(defaultName(repo.getProjectRef()));
        }
        if (req.getDefaultTarget() != null) {
            repo.setDefaultTarget(Texts.cut(Texts.trimToNull(req.getDefaultTarget()), 80));
        }
        if (req.getSyncEnabled() != null) {
            repo.setSyncEnabled(req.getSyncEnabled());
        } else if (creating) {
            repo.setSyncEnabled(Boolean.TRUE);
        } else if (repo.getSyncEnabled() == null) {
            repo.setSyncEnabled(Boolean.TRUE);
        }
        if (Texts.trimToNull(repo.getProvider()) == null) {
            repo.setProvider("gitlab");
        }
        if (Boolean.TRUE.equals(req.getClearToken())) {
            repo.setTokenCipher(null);
        } else {
            String token = Texts.trimToNull(req.getToken());
            if (token != null) {
                repo.setTokenCipher(aiCrypto.encrypt(token));
            }
        }
    }

    private String normalizeUrl(String raw, boolean creating) {
        String url = Texts.trimToNull(raw);
        if (url == null) {
            if (creating) {
                throw AppException.badRequest("请填写 GitLab 站点地址");
            }
            return null;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        String err = Webhooks.check(url, allowPrivate);
        if (err != null) {
            throw AppException.badRequest(err + "（自建内网 GitLab 需开启 app.git.allow-private）");
        }
        return url;
    }

    private static String defaultName(String projectRef) {
        if (projectRef == null) {
            return null;
        }
        int idx = projectRef.lastIndexOf('/');
        String name = idx >= 0 ? projectRef.substring(idx + 1) : projectRef;
        return Texts.cut(name, 80);
    }
}
