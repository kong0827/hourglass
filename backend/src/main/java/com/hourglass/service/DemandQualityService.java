package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.DemandCheckRequest;
import com.hourglass.dto.DemandCheckResponse;
import com.hourglass.entity.Demand;
import com.hourglass.mapper.DemandMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 需求提交前体检：只读、无 AI、不落库。
 * <p>
 * 检查口径刻意保持「可解释」：缺验收标准、描述过短、P0/P1 缺期望交付、同项目标题关键词重合。
 * 不做语义改写，也不给模型置信度；相似度只用于排序与说明，最终是否提交由用户决定。
 */
@Service
public class DemandQualityService {

    /** 相似需求最多返回 3 条，避免一次摊开让用户无从选择 */
    private static final int MAX_SIMILAR = 3;
    /** 标题二元组重合度低于该值不展示，宁可漏报也不误报 */
    private static final double MIN_SCORE = 0.34;
    /** 至少重合 3 个词/二元组，避免「支持」「优化」这类泛词造成误报 */
    private static final int MIN_SHARED = 3;
    private static final int DESCRIPTION_MIN = 20;
    private static final int ACCEPT_MIN = 10;

    private final DemandMapper demandMapper;
    private final ProjectAccessService projectAccess;

    public DemandQualityService(DemandMapper demandMapper, ProjectAccessService projectAccess) {
        this.demandMapper = demandMapper;
        this.projectAccess = projectAccess;
    }

    public DemandCheckResponse check(String workspaceId, String userId, DemandCheckRequest req) {
        if (req == null) {
            throw AppException.badRequest("请填写需求内容");
        }
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        String title = Texts.trimToNull(req.getTitle());
        if (title == null) {
            throw AppException.badRequest("请填写需求标题");
        }
        /* 项目不可见按不存在处理，和需求列表的读口径一致 */
        projectAccess.assertView(workspaceId, userId, reqId);

        DemandCheckResponse res = new DemandCheckResponse();
        collectIssues(req, res);

        String excludeId = Texts.trimToNull(req.getExcludeId());
        Set<String> titleKeys = keys(title);
        if (!titleKeys.isEmpty()) {
            List<Demand> existing = demandMapper.selectByReq(workspaceId, reqId);
            List<DemandCheckResponse.Similar> similar = new ArrayList<DemandCheckResponse.Similar>();
            for (Demand d : existing) {
                if (d == null || d.getId() == null) {
                    continue;
                }
                if (excludeId != null && excludeId.equals(d.getId())) {
                    continue;
                }
                if (isClosed(d.getStatus())) {
                    continue;
                }
                Set<String> otherKeys = keys(d.getTitle());
                if (otherKeys.isEmpty()) {
                    continue;
                }
                int shared = shared(titleKeys, otherKeys);
                if (shared < MIN_SHARED) {
                    continue;
                }
                double dice = 2.0 * shared / (titleKeys.size() + otherKeys.size());
                if (dice < MIN_SCORE) {
                    continue;
                }
                DemandCheckResponse.Similar s = new DemandCheckResponse.Similar();
                s.setId(d.getId());
                s.setDemandNo(d.getDemandNo());
                s.setTitle(d.getTitle());
                s.setStatus(d.getStatus());
                s.setCloseReason(d.getCloseReason());
                s.setPriority(d.getPriority());
                s.setVersionName(d.getVersionName());
                s.setScore((int) Math.round(dice * 100));
                similar.add(s);
            }
            similar.sort(new Comparator<DemandCheckResponse.Similar>() {
                @Override
                public int compare(DemandCheckResponse.Similar a, DemandCheckResponse.Similar b) {
                    int byScore = Integer.compare(b.getScore(), a.getScore());
                    if (byScore != 0) {
                        return byScore;
                    }
                    int an = a.getDemandNo() == null ? -1 : a.getDemandNo();
                    int bn = b.getDemandNo() == null ? -1 : b.getDemandNo();
                    return Integer.compare(bn, an);
                }
            });
            if (similar.size() > MAX_SIMILAR) {
                res.setSimilar(new ArrayList<DemandCheckResponse.Similar>(similar.subList(0, MAX_SIMILAR)));
            } else {
                res.setSimilar(similar);
            }
        }
        return res;
    }

    private void collectIssues(DemandCheckRequest req, DemandCheckResponse res) {
        String accept = Texts.trimToNull(req.getAcceptText());
        if (accept == null) {
            res.getIssues().add(issue("acceptText", "warn", "没有验收标准",
                    "评审和验收都缺依据，建议写清「做到什么程度算完成」，例如范围、字段与格式。"));
        } else if (accept.length() < ACCEPT_MIN) {
            res.getIssues().add(issue("acceptText", "info", "验收标准偏短",
                    "只有 " + accept.length() + " 个字，可能无法判断是否完成；建议补上判定条件。"));
        }

        String desc = Texts.trimToNull(req.getDescription());
        if (desc == null) {
            res.getIssues().add(issue("description", "warn", "没有需求描述",
                    "只有标题，评审时还要反复问背景；建议补充使用场景和要解决的问题。"));
        } else if (desc.length() < DESCRIPTION_MIN) {
            res.getIssues().add(issue("description", "info", "需求描述只有 " + desc.length() + " 个字",
                    "评审时还要反复问背景，建议补充使用场景、数据口径和要解决的问题。"));
        }

        String pri = Texts.trimToNull(req.getPriority());
        if (("P0".equals(pri) || "P1".equals(pri)) && req.getExpectDate() == null) {
            res.getIssues().add(issue("expectDate", "info", pri + " 需求还没有期望交付日期",
                    "评审通过后排期还要补；先给一个目标日期，能提前发现和已有承诺的冲突。"));
        }
    }

    private static DemandCheckResponse.Issue issue(String field, String level, String title, String detail) {
        DemandCheckResponse.Issue issue = new DemandCheckResponse.Issue();
        issue.setField(field);
        issue.setLevel(level);
        issue.setTitle(title);
        issue.setDetail(detail);
        return issue;
    }

    private static boolean isClosed(String status) {
        return "closed".equals(status) || "rej".equals(status)
                || "canceled".equals(status) || "cancelled".equals(status);
    }

    private static int shared(Set<String> a, Set<String> b) {
        int n = 0;
        for (String key : a) {
            if (b.contains(key)) {
                n++;
            }
        }
        return n;
    }

    /**
     * 中文按连续段的二元组、英文/数字按词切分；标点与空白全部忽略。
     * 二元组足够稳，不需要引入分词器，也能覆盖用户改一两个字的重复需求。
     */
    static Set<String> keys(String text) {
        Set<String> out = new LinkedHashSet<String>();
        if (text == null) {
            return out;
        }
        String lower = text.toLowerCase(Locale.ROOT);
        StringBuilder cjk = new StringBuilder();
        StringBuilder word = new StringBuilder();
        for (int i = 0; i <= lower.length(); i++) {
            char c = i < lower.length() ? lower.charAt(i) : ' ';
            boolean isCjk = c >= '\u4e00' && c <= '\u9fa5';
            boolean isWord = !isCjk && Character.isLetterOrDigit(c);
            if (isCjk) {
                flushWord(word, out);
                cjk.append(c);
            } else if (isWord) {
                flushCjk(cjk, out);
                word.append(c);
            } else {
                flushCjk(cjk, out);
                flushWord(word, out);
            }
        }
        return out;
    }

    private static void flushCjk(StringBuilder sb, Set<String> out) {
        if (sb.length() == 0) {
            return;
        }
        if (sb.length() == 1) {
            out.add(sb.toString());
        } else {
            for (int i = 0; i + 1 < sb.length(); i++) {
                out.add(sb.substring(i, i + 2));
            }
        }
        sb.setLength(0);
    }

    private static void flushWord(StringBuilder sb, Set<String> out) {
        if (sb.length() >= 2) {
            out.add(sb.toString());
        }
        sb.setLength(0);
    }
}
