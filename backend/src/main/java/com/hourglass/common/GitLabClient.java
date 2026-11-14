package com.hourglass.common;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * GitLab v4 只读客户端：分支列表 + 已合并 MR 列表。
 *
 * <p>只做 GET，不写回仓库；令牌通过 PRIVATE-TOKEN 头传递，任何异常信息都不带令牌。
 * 地址在每次调用前重新做 SSRF 校验（DNS 可能变化），内网部署需显式开启
 * {@code app.git.allow-private}。
 */
@Component
public class GitLabClient {

    private static final int PER_PAGE = 100;
    /** 防御异常响应：单类资源最多翻 100 页（1 万条） */
    private static final int MAX_PAGES = 100;

    private final RestTemplate restTemplate;
    private final boolean allowPrivate;

    public GitLabClient(@Qualifier("gitRestTemplate") RestTemplate gitRestTemplate,
                        @Value("${app.git.allow-private:false}") boolean allowPrivate) {
        this.restTemplate = gitRestTemplate;
        this.allowPrivate = allowPrivate;
    }

    public static class RemoteBranch {
        public String name;
        public String sha;
        public LocalDateTime committedAt;
        public String author;
    }

    public static class MergedMr {
        public String iid;
        public String sourceBranch;
        public String targetBranch;
        public LocalDateTime mergedAt;
        public String webUrl;
    }

    public List<RemoteBranch> listBranches(String repoUrl, String projectRef, String token) {
        List<RemoteBranch> out = new ArrayList<RemoteBranch>();
        for (BranchDto dto : getAll(repoUrl, projectRef, token, "/repository/branches",
                new ParameterizedTypeReference<List<BranchDto>>() { })) {
            if (dto == null || Texts.trimToNull(dto.name) == null) {
                continue;
            }
            RemoteBranch b = new RemoteBranch();
            b.name = dto.name;
            if (dto.commit != null) {
                b.sha = dto.commit.id;
                b.committedAt = parseTime(dto.commit.committedDate);
                b.author = dto.commit.authorName;
            }
            out.add(b);
        }
        return out;
    }

    public List<MergedMr> listMergedMrs(String repoUrl, String projectRef, String token) {
        List<MergedMr> out = new ArrayList<MergedMr>();
        List<MrDto> dtos = getAll(repoUrl, projectRef, token,
                "/merge_requests?state=merged", new ParameterizedTypeReference<List<MrDto>>() { });
        for (MrDto dto : dtos) {
            if (dto == null || Texts.trimToNull(dto.sourceBranch) == null) {
                continue;
            }
            MergedMr mr = new MergedMr();
            mr.iid = dto.iid == null ? null : String.valueOf(dto.iid);
            mr.sourceBranch = dto.sourceBranch;
            mr.targetBranch = dto.targetBranch;
            mr.mergedAt = parseTime(dto.mergedAt);
            mr.webUrl = dto.webUrl;
            out.add(mr);
        }
        return out;
    }

    private <T> List<T> getAll(String repoUrl, String projectRef, String token, String path,
                               ParameterizedTypeReference<List<T>> type) {
        String err = Webhooks.check(repoUrl, allowPrivate);
        if (err != null) {
            throw AppException.badRequest(err + "（自建内网 GitLab 需开启 app.git.allow-private）");
        }
        String base = trimSlash(repoUrl) + "/api/v4/projects/" + encode(projectRef);
        List<T> all = new ArrayList<T>();
        for (int page = 1; page <= MAX_PAGES; page++) {
            URI uri = URI.create(base + path + (path.contains("?") ? "&" : "?")
                    + "per_page=" + PER_PAGE + "&page=" + page);
            ResponseEntity<List<T>> resp;
            try {
                resp = restTemplate.exchange(uri, HttpMethod.GET, new HttpEntity<Void>(headers(token)), type);
            } catch (RestClientResponseException ex) {
                throw AppException.badRequest(gitErrorMessage(ex.getRawStatusCode(), ex.getStatusText()));
            } catch (Exception ex) {
                throw AppException.badRequest("无法访问 GitLab：" + safeMessage(ex));
            }
            List<T> body = resp.getBody();
            if (body == null || body.isEmpty()) {
                break;
            }
            all.addAll(body);
            String next = resp.getHeaders().getFirst("X-Next-Page");
            if (next == null || next.trim().isEmpty()) {
                break;
            }
        }
        return all;
    }

    private HttpHeaders headers(String token) {
        HttpHeaders h = new HttpHeaders();
        h.set("Accept", "application/json");
        if (Texts.trimToNull(token) != null) {
            h.set("PRIVATE-TOKEN", token.trim());
        }
        return h;
    }

    private static String gitErrorMessage(int status, String statusText) {
        if (status == 401 || status == 403) {
            return "GitLab 鉴权失败（请检查访问令牌是否有 read_api 权限）";
        }
        if (status == 404) {
            return "GitLab 项目不存在或无权访问（检查站点地址与 project_ref）";
        }
        if (status == 429) {
            return "GitLab 请求过于频繁，请稍后重试";
        }
        return "GitLab 返回 " + status + (statusText == null || statusText.isEmpty() ? "" : " " + statusText);
    }

    /** 只保留异常类型与简短描述，绝不透传可能携带凭据的完整 URL */
    private static String safeMessage(Exception ex) {
        String msg = ex.getMessage();
        if (msg == null || msg.isEmpty()) {
            return ex.getClass().getSimpleName();
        }
        int cut = Math.min(msg.length(), 160);
        return msg.substring(0, cut);
    }

    private static String trimSlash(String url) {
        String s = url == null ? "" : url.trim();
        while (s.endsWith("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    /** project_ref 里的 group/project 必须整体编码成 %2F，不能靠 UriComponentsBuilder 二次编码 */
    private static String encode(String projectRef) {
        try {
            return URLEncoder.encode(projectRef == null ? "" : projectRef.trim(), "UTF-8")
                    .replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException("UTF-8 不可用", e);
        }
    }

    private static LocalDateTime parseTime(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
        } catch (Exception e) {
            try {
                return LocalDateTime.parse(raw);
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    static class BranchDto {
        public String name;
        public CommitDto commit;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CommitDto {
        public String id;
        @com.fasterxml.jackson.annotation.JsonProperty("committed_date")
        public String committedDate;
        @com.fasterxml.jackson.annotation.JsonProperty("author_name")
        public String authorName;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    static class MrDto {
        public Integer iid;
        @com.fasterxml.jackson.annotation.JsonProperty("source_branch")
        public String sourceBranch;
        @com.fasterxml.jackson.annotation.JsonProperty("target_branch")
        public String targetBranch;
        @com.fasterxml.jackson.annotation.JsonProperty("merged_at")
        public String mergedAt;
        @com.fasterxml.jackson.annotation.JsonProperty("web_url")
        public String webUrl;
    }
}
