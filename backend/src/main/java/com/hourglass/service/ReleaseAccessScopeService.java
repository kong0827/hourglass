package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReleaseAccessScopeDto;
import com.hourglass.mapper.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 空间级发布相关权限，两组独立配置：
 * <ul>
 *   <li>发布维护权限：哪几种身份可以维护发布计划、预览并记录发布事实；</li>
 *   <li>人工标记发布权限：哪几种身份可以补录「已发布」历史事实，只影响徽标与筛选。</li>
 * </ul>
 * 只决定发布侧；版本新建 / 编辑 / 内容调整仍按项目写权限，查看者永远无权。
 */
@Service
public class ReleaseAccessScopeService {
    public static final String SCOPE_OWNER = "owner";
    public static final String SCOPE_ADMIN = "admin";
    public static final String SCOPE_PROJECT_OWNER = "project_owner";
    public static final String SCOPE_PROJECT_WRITE = "project_write";

    private static final List<String> OPTIONS = Collections.unmodifiableList(Arrays.asList(
            SCOPE_OWNER, SCOPE_ADMIN, SCOPE_PROJECT_OWNER, SCOPE_PROJECT_WRITE));
    /** 与调整前的管理者口径一致：空间主、管理员、项目负责人（且对该项目可写） */
    private static final List<String> DEFAULTS = Collections.unmodifiableList(Arrays.asList(
            SCOPE_OWNER, SCOPE_ADMIN, SCOPE_PROJECT_OWNER));
    private static final Map<String, String> LABELS;
    private static final Map<String, String> DESCRIPTIONS;
    private static final Map<String, String> PUBLICATION_DESCRIPTIONS;

    static {
        Map<String, String> labels = new LinkedHashMap<String, String>();
        labels.put(SCOPE_OWNER, "空间主");
        labels.put(SCOPE_ADMIN, "管理员");
        labels.put(SCOPE_PROJECT_OWNER, "项目负责人");
        labels.put(SCOPE_PROJECT_WRITE, "项目可写成员");
        LABELS = Collections.unmodifiableMap(labels);
        Map<String, String> descriptions = new LinkedHashMap<String, String>();
        descriptions.put(SCOPE_OWNER, "空间主可维护任何项目的发布；取消后，空间主只在同时满足其他已勾选身份的项目上保留权限");
        descriptions.put(SCOPE_ADMIN, "管理员与空间主同权；取消后，管理员只在同时满足其他已勾选身份的项目上保留权限");
        descriptions.put(SCOPE_PROJECT_OWNER, "仅限本人负责、且当前对该项目可写的项目");
        descriptions.put(SCOPE_PROJECT_WRITE, "对项目有写权限的成员即可维护，最宽松；已包含空间主与管理员，勾选时取消这两项不改变其权限");
        DESCRIPTIONS = Collections.unmodifiableMap(descriptions);
        Map<String, String> publicationDescriptions = new LinkedHashMap<String, String>();
        publicationDescriptions.put(SCOPE_OWNER, "空间主可标记任何项目的工作项；取消后，空间主只在同时满足其他已勾选身份的项目上保留权限");
        publicationDescriptions.put(SCOPE_ADMIN, "管理员与空间主同权；取消后，管理员只在同时满足其他已勾选身份的项目上保留权限");
        publicationDescriptions.put(SCOPE_PROJECT_OWNER, "仅限本人负责、且当前对该项目可写的项目");
        publicationDescriptions.put(SCOPE_PROJECT_WRITE, "对项目有写权限的成员即可标记，最宽松；已包含空间主与管理员，勾选时取消这两项不改变其权限");
        PUBLICATION_DESCRIPTIONS = Collections.unmodifiableMap(publicationDescriptions);
    }

    private final WorkspaceMapper workspaceMapper;
    private final ActivityService activityService;

    public ReleaseAccessScopeService(WorkspaceMapper workspaceMapper, ActivityService activityService) {
        this.workspaceMapper = workspaceMapper;
        this.activityService = activityService;
    }

    public List<String> get(String workspaceId) {
        return parse(workspaceMapper.selectReleaseAccessScope(workspaceId));
    }

    /** 保存整份勾选：至少一项、未知项拒绝；值没变不写库也不留痕。 */
    @Transactional
    public List<String> save(String workspaceId, List<String> selected, String operatorId) {
        List<String> normalized = normalize(selected);
        List<String> before = get(workspaceId);
        if (before.equals(normalized)) {
            return normalized;
        }
        workspaceMapper.updateReleaseAccessScope(workspaceId, encode(normalized));
        activityService.logConfig(workspaceId, operatorId, "更新发布维护权限：" + text(before) + " → " + text(normalized));
        return normalized;
    }

    public ReleaseAccessScopeDto view(String workspaceId) {
        return viewOf(get(workspaceId), DESCRIPTIONS);
    }

    public List<String> getPublication(String workspaceId) {
        return parse(workspaceMapper.selectPublicationAccessScope(workspaceId));
    }

    /** 保存人工标记发布权限整份勾选：至少一项、未知项拒绝；值没变不写库也不留痕。 */
    @Transactional
    public List<String> savePublication(String workspaceId, List<String> selected, String operatorId) {
        List<String> normalized = normalize(selected, "人工标记工作项发布");
        List<String> before = getPublication(workspaceId);
        if (before.equals(normalized)) {
            return normalized;
        }
        workspaceMapper.updatePublicationAccessScope(workspaceId, encode(normalized));
        activityService.logConfig(workspaceId, operatorId,
                "更新人工标记发布权限：" + text(before) + " → " + text(normalized));
        return normalized;
    }

    public ReleaseAccessScopeDto viewPublication(String workspaceId) {
        return viewOf(getPublication(workspaceId), PUBLICATION_DESCRIPTIONS);
    }

    private ReleaseAccessScopeDto viewOf(List<String> selected, Map<String, String> descriptions) {
        ReleaseAccessScopeDto dto = new ReleaseAccessScopeDto();
        dto.setSelected(new ArrayList<String>(selected));
        List<ReleaseAccessScopeDto.Option> options = new ArrayList<ReleaseAccessScopeDto.Option>();
        for (String value : OPTIONS) {
            options.add(new ReleaseAccessScopeDto.Option(value, LABELS.get(value), descriptions.get(value)));
        }
        dto.setOptions(options);
        return dto;
    }

    /** 空值回落到默认管理者口径；未知项忽略，避免历史脏值把权限判定打成 500。 */
    public static List<String> parse(String raw) {
        if (raw == null) {
            return new ArrayList<String>(DEFAULTS);
        }
        Set<String> tokens = new LinkedHashSet<String>();
        for (String part : raw.split(",")) {
            String token = part.trim();
            if (OPTIONS.contains(token)) {
                tokens.add(token);
            }
        }
        if (tokens.isEmpty()) {
            return new ArrayList<String>(DEFAULTS);
        }
        return ordered(tokens);
    }

    public static List<String> normalize(List<String> raw) {
        return normalize(raw, "可维护发布计划与发布记录");
    }

    public static List<String> normalize(List<String> raw, String scopeName) {
        if (raw == null) {
            throw AppException.badRequest("请选择" + scopeName + "的身份");
        }
        Set<String> tokens = new LinkedHashSet<String>();
        for (String value : raw) {
            String token = value == null ? "" : value.trim();
            if (token.isEmpty()) {
                continue;
            }
            if (!OPTIONS.contains(token)) {
                throw AppException.badRequest(scopeName + "权限包含无效身份：" + token);
            }
            tokens.add(token);
        }
        if (tokens.isEmpty()) {
            throw AppException.badRequest(scopeName + "权限至少保留一项");
        }
        return ordered(tokens);
    }

    /** 固定顺序，便于比较与留痕；未知项已在 parse / normalize 阶段滤掉。 */
    private static List<String> ordered(Set<String> tokens) {
        List<String> result = new ArrayList<String>();
        for (String option : OPTIONS) {
            if (tokens.contains(option)) {
                result.add(option);
            }
        }
        return result;
    }

    public static String encode(List<String> tokens) {
        return String.join(",", tokens);
    }

    public static String label(String token) {
        String label = LABELS.get(token);
        return label == null ? token : label;
    }

    /** 「空间主、管理员」——提示与审计文案共用。 */
    public static String text(List<String> tokens) {
        List<String> labels = new ArrayList<String>();
        for (String token : tokens) {
            labels.add(label(token));
        }
        return String.join("、", labels);
    }
}
