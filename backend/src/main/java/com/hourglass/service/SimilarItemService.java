package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.SimilarityText;
import com.hourglass.dto.SimilarCheckRequest;
import com.hourglass.dto.SimilarCheckResponse;
import com.hourglass.dto.SimilarSourceRow;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.TaskMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 新建需求 / 缺陷时的相似条目提示：纯规则，不调用模型、不落库。
 *
 * <p>候选只来自当前用户可查看的项目（SQL 里按 project_member.access='none' 排除），
 * 标题二元组相似度为主、描述相似度为辅；只提示，不阻止提交，也不替用户判定「重复」。
 */
@Service
public class SimilarItemService {

    public static final String KIND_DEMAND = "demand";
    public static final String KIND_DEFECT = "defect";

    /** 最多回 3 条：再多就变成噪音，用户不会逐条看 */
    private static final int MAX_ITEMS = 3;
    /** 标题归一后少于 3 个字不查：太短的词几乎和所有条目都像 */
    private static final int MIN_TITLE_CHARS = 3;
    /** 单次最多扫 1200 条近期条目；相似提示不值得为一次输入翻整个空间 */
    private static final int SCAN_LIMIT = 1200;
    /** 标题为主、描述只做小幅修正；低于阈值宁可不提示 */
    private static final double THRESHOLD = 0.62;
    private static final double DESC_WEIGHT = 0.2;
    private static final int SNIPPET_CHARS = 80;
    private static final int DESC_COMPARE_CHARS = 400;

    private final DemandMapper demandMapper;
    private final TaskMapper taskMapper;
    private final ProjectAccessService projectAccess;

    public SimilarItemService(DemandMapper demandMapper, TaskMapper taskMapper,
                              ProjectAccessService projectAccess) {
        this.demandMapper = demandMapper;
        this.taskMapper = taskMapper;
        this.projectAccess = projectAccess;
    }

    public SimilarCheckResponse check(String userId, String workspaceId, SimilarCheckRequest req) {
        if (req == null) {
            throw AppException.badRequest("缺少检查参数");
        }
        String kind = trim(req.getKind(), 16).toLowerCase();
        if (!KIND_DEMAND.equals(kind) && !KIND_DEFECT.equals(kind)) {
            throw AppException.badRequest("检查类型只能是需求或缺陷");
        }
        String title = trim(req.getTitle(), 200);
        String projectId = trim(req.getProjectId(), 32);
        SimilarCheckResponse res = new SimilarCheckResponse();
        res.setKind(kind);
        /* 太短的标题不查：查了只会把无关条目推到用户面前 */
        if (SimilarityText.normalize(title).length() < MIN_TITLE_CHARS) {
            return res;
        }
        if (!projectId.isEmpty()) {
            projectAccess.assertView(workspaceId, userId, projectId);
        }
        String excludeId = trim(req.getExcludeId(), 32);
        List<SimilarSourceRow> rows = KIND_DEMAND.equals(kind)
                ? demandMapper.selectSimilarSources(workspaceId, userId,
                        excludeId.isEmpty() ? null : excludeId, SCAN_LIMIT)
                : taskMapper.selectSimilarDefects(workspaceId, userId,
                        excludeId.isEmpty() ? null : excludeId, SCAN_LIMIT);

        String normTitle = SimilarityText.normalize(title);
        String normDesc = SimilarityText.normalize(trim(req.getDescription(), 4000));
        List<SimilarCheckResponse.Item> items = new ArrayList<SimilarCheckResponse.Item>();
        Set<String> seenTitles = new HashSet<String>();
        for (SimilarSourceRow row : rows) {
            if (row == null || row.getTitle() == null) {
                continue;
            }
            String rowNorm = SimilarityText.normalize(row.getTitle());
            if (rowNorm.isEmpty() || !seenTitles.add(rowNorm)) {
                continue;
            }
            double score = score(normTitle, normDesc, SimilarityText.normalize(row.getTitle()),
                    row.getDescription());
            if (score < THRESHOLD) {
                continue;
            }
            SimilarCheckResponse.Item item = new SimilarCheckResponse.Item();
            item.setId(row.getId());
            item.setItemNo(row.getItemNo());
            item.setTitle(row.getTitle());
            item.setStatus(row.getStatus());
            item.setStatusName(KIND_DEMAND.equals(kind)
                    ? demandStatusName(row.getStatus()) : fallback(row.getStatusName(), row.getStatus()));
            item.setProjectId(row.getProjectId());
            item.setProjectName(fallback(row.getProjectName(), "未归属项目"));
            item.setSnippet(SimilarityText.plainSnippet(row.getDescription(), SNIPPET_CHARS));
            item.setScore(Math.round(score * 100) / 100.0);
            items.add(item);
        }
        items.sort(new Comparator<SimilarCheckResponse.Item>() {
            @Override
            public int compare(SimilarCheckResponse.Item a, SimilarCheckResponse.Item b) {
                return Double.compare(b.getScore() == null ? 0 : b.getScore(),
                        a.getScore() == null ? 0 : a.getScore());
            }
        });
        if (items.size() > MAX_ITEMS) {
            items = new ArrayList<SimilarCheckResponse.Item>(items.subList(0, MAX_ITEMS));
        }
        res.setItems(items);
        return res;
    }

    /** 标题为主；两边描述都够长时才把描述相似度按 20% 计入 */
    static double score(String normTitle, String normDesc, String otherTitle, String otherDesc) {
        double titleScore = SimilarityText.titleScore(normTitle, otherTitle);
        String otherDescNorm = SimilarityText.normalize(SimilarityText.plainSnippet(
                otherDesc, DESC_COMPARE_CHARS));
        if (normDesc.length() < 8 || otherDescNorm.length() < 8) {
            return titleScore;
        }
        double descScore = SimilarityText.dice(normDesc, otherDescNorm);
        return titleScore * (1 - DESC_WEIGHT) + descScore * DESC_WEIGHT;
    }

    private static String demandStatusName(String status) {
        if (status == null) {
            return "未记录";
        }
        if ("review".equals(status)) {
            return "待评审";
        }
        if ("pass".equals(status)) {
            return "已通过";
        }
        if ("plan".equals(status)) {
            return "已排期";
        }
        if ("done".equals(status)) {
            return "已完成";
        }
        if ("closed".equals(status) || "rej".equals(status)) {
            return "已关闭";
        }
        if ("canceled".equals(status) || "cancelled".equals(status)) {
            return "已取消";
        }
        return status;
    }

    private static String fallback(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    private static String trim(String value, int max) {
        if (value == null) {
            return "";
        }
        String t = value.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }
}
