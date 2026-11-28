package com.hourglass.service;

import com.hourglass.dto.AiUsage;
import com.hourglass.mapper.AiUsageMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 助手用量：按空间 + 日期 + 回答类型做日聚合。
 * 记录失败不影响对话本身；看板只对平台管理员开放。
 */
@Service
public class AiUsageService {

    private static final Logger log = LoggerFactory.getLogger(AiUsageService.class);
    private static final int MAX_INTENT = 48;

    private final AiUsageMapper mapper;

    @Value("${app.assistant.usage.enabled:true}")
    private boolean enabled;

    public AiUsageService(AiUsageMapper mapper) {
        this.mapper = mapper;
    }

    public void record(String workspaceId, String intent, AiUsage usage, boolean success, long elapsedMs) {
        if (!enabled || workspaceId == null) {
            return;
        }
        try {
            String key = intent == null || intent.trim().isEmpty() ? "unknown" : intent.trim();
            if (key.length() > MAX_INTENT) {
                key = key.substring(0, MAX_INTENT);
            }
            int prompt = usage == null ? 0 : usage.getPromptTokens();
            int completion = usage == null ? 0 : usage.getCompletionTokens();
            mapper.record(workspaceId, LocalDate.now(), key, success ? 0 : 1,
                    Math.max(0, prompt), Math.max(0, completion), Math.max(0, elapsedMs));
        } catch (Exception e) {
            log.warn("AI 助手用量写入失败（intent={}）：{}", intent, e.getMessage());
        }
    }

    public Map<String, Object> dashboard(String workspaceId, Integer days) {
        int d = days == null ? 7 : Math.max(1, Math.min(30, days));
        LocalDate from = LocalDate.now().minusDays(d - 1L);
        List<Map<String, Object>> daily = mapper.daily(workspaceId, from);
        List<Map<String, Object>> top = mapper.topIntents(workspaceId, from, 8);

        long calls = 0;
        long failures = 0;
        long prompt = 0;
        long completion = 0;
        long totalMs = 0;
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : daily) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("day", String.valueOf(r.get("day")));
            row.put("calls", num(r.get("calls")));
            row.put("failures", num(r.get("failures")));
            row.put("promptTokens", num(r.get("prompt_tokens")));
            row.put("completionTokens", num(r.get("completion_tokens")));
            row.put("totalMs", num(r.get("total_ms")));
            rows.add(row);
            calls += num(r.get("calls"));
            failures += num(r.get("failures"));
            prompt += num(r.get("prompt_tokens"));
            completion += num(r.get("completion_tokens"));
            totalMs += num(r.get("total_ms"));
        }

        List<Map<String, Object>> tops = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : top) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("intent", String.valueOf(r.get("intent")));
            row.put("calls", num(r.get("calls")));
            row.put("failures", num(r.get("failures")));
            row.put("tokens", num(r.get("tokens")));
            tops.add(row);
        }

        Map<String, Object> totals = new LinkedHashMap<String, Object>();
        totals.put("calls", calls);
        totals.put("failures", failures);
        totals.put("promptTokens", prompt);
        totals.put("completionTokens", completion);
        totals.put("tokens", prompt + completion);
        totals.put("avgMs", calls == 0 ? 0 : Math.round((double) totalMs / calls));
        totals.put("successRatePct", calls == 0 ? null : Math.round((calls - failures) * 1000.0 / calls) / 10.0);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("days", d);
        out.put("from", from.toString());
        out.put("totals", totals);
        out.put("daily", rows);
        out.put("top", tops);
        return out;
    }

    private static long num(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }
}
