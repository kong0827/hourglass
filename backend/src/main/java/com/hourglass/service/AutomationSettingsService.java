package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.hourglass.common.AppException;
import com.hourglass.entity.WorkspaceAutomation;
import com.hourglass.mapper.AutomationRunMapper;
import com.hourglass.mapper.WorkspaceAutomationMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 自动化规则开关与去重口径。
 *
 * <p>没有配置行时按开启处理：内置规则属于「装好就能用」，用户主动关闭才写 false。
 * 规则的执行逻辑分散在 {@link AutomationService}、发布服务和版本服务中，本类只读开关，
 * 避免各处重复解释默认值与参数格式。
 */
@Service
public class AutomationSettingsService {

    public static final String OVERDUE_REMINDER = "overdue_reminder";
    public static final String RELEASE_NOTIFY = "release_notify";
    public static final String STATUS_SYNC = "status_sync";

    public static final int DEFAULT_OVERDUE_DAYS = 3;
    private static final int MIN_OVERDUE_DAYS = 1;
    private static final int MAX_OVERDUE_DAYS = 30;

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final class RuleDef {
        final String key;
        final String name;
        final String description;
        final boolean configurableDays;

        RuleDef(String key, String name, String description, boolean configurableDays) {
            this.key = key;
            this.name = name;
            this.description = description;
            this.configurableDays = configurableDays;
        }
    }

    private static final List<RuleDef> DEFS = Collections.unmodifiableList(Arrays.asList(
            new RuleDef(OVERDUE_REMINDER, "逾期提醒",
                    "每天 10:00 把逾期超过指定天数、仍未完成的工作项单独提醒负责人；同一人同一天只提醒一次。", true),
            new RuleDef(RELEASE_NOTIFY, "发布通知",
                    "版本成功生产发布后，通知被本次发布带走的工作项负责人；通知中心可按版本打开交付说明。", false),
            new RuleDef(STATUS_SYNC, "状态同步",
                    "版本内第一个工作项开始处理（离开待处理列）时，自动把「计划中」版本置为「进行中」，并保留开始时间与承诺基线。", false)));

    private final WorkspaceAutomationMapper mapper;
    private final AutomationRunMapper runMapper;

    public AutomationSettingsService(WorkspaceAutomationMapper mapper, AutomationRunMapper runMapper) {
        this.mapper = mapper;
        this.runMapper = runMapper;
    }

    /** 没有记录视为开启；读失败同样按开启处理，规则属于低频增强，不应因一次读异常静默消失。 */
    public boolean enabled(String workspaceId, String ruleKey) {
        if (workspaceId == null) {
            return false;
        }
        try {
            WorkspaceAutomation rule = mapper.selectOne(workspaceId, ruleKey);
            return rule == null || !Boolean.FALSE.equals(rule.getEnabled());
        } catch (Exception e) {
            return true;
        }
    }

    public int overdueDays(String workspaceId) {
        WorkspaceAutomation rule = mapper.selectOne(workspaceId, OVERDUE_REMINDER);
        int days = DEFAULT_OVERDUE_DAYS;
        if (rule != null && rule.getConfigJson() != null) {
            try {
                JsonNode node = JSON.readTree(rule.getConfigJson());
                if (node != null && node.hasNonNull("days")) {
                    days = node.get("days").asInt(DEFAULT_OVERDUE_DAYS);
                }
            } catch (Exception ignored) {
                // 配置损坏时回落到默认值，不让提醒因此停摆
            }
        }
        return Math.max(MIN_OVERDUE_DAYS, Math.min(MAX_OVERDUE_DAYS, days));
    }

    /** 设置页读取：合并默认值与已保存行，附带最近一次执行结果。 */
    public Map<String, Object> view(String workspaceId) {
        Map<String, WorkspaceAutomation> saved = new LinkedHashMap<String, WorkspaceAutomation>();
        for (WorkspaceAutomation rule : mapper.selectByWorkspace(workspaceId)) {
            saved.put(rule.getRuleKey(), rule);
        }
        int days = overdueDays(workspaceId);
        List<Map<String, Object>> rules = new ArrayList<Map<String, Object>>();
        for (RuleDef def : DEFS) {
            WorkspaceAutomation rule = saved.get(def.key);
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("key", def.key);
            row.put("name", def.name);
            row.put("description", def.description);
            row.put("enabled", rule == null || !Boolean.FALSE.equals(rule.getEnabled()));
            row.put("configurableDays", def.configurableDays);
            if (def.configurableDays) {
                row.put("days", days);
            }
            row.put("lastRunAt", rule == null ? null : rule.getLastRunAt());
            row.put("lastStatus", rule == null ? null : rule.getLastStatus());
            rules.add(row);
        }
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("rules", rules);
        return res;
    }

    @Transactional
    public Map<String, Object> updateRules(String userId, String workspaceId, Map<String, Object> body) {
        if (body == null) {
            throw AppException.badRequest("缺少规则配置");
        }
        Integer days = null;
        if (body.containsKey("overdueDays")) {
            Object raw = body.get("overdueDays");
            if (!(raw instanceof Number)) {
                throw AppException.badRequest("逾期天数必须是数字");
            }
            days = ((Number) raw).intValue();
            if (days < MIN_OVERDUE_DAYS || days > MAX_OVERDUE_DAYS) {
                throw AppException.badRequest("逾期天数需在 1–30 天之间");
            }
        }
        Object rulesRaw = body.get("rules");
        if (!(rulesRaw instanceof Map)) {
            throw AppException.badRequest("缺少规则开关");
        }
        Map<?, ?> rules = (Map<?, ?>) rulesRaw;
        for (RuleDef def : DEFS) {
            if (!rules.containsKey(def.key)) {
                continue;
            }
            Object value = rules.get(def.key);
            if (!(value instanceof Boolean)) {
                throw AppException.badRequest("规则开关必须是布尔值：" + def.key);
            }
            WorkspaceAutomation row = new WorkspaceAutomation();
            row.setWorkspaceId(workspaceId);
            row.setRuleKey(def.key);
            row.setEnabled((Boolean) value);
            row.setUpdatedBy(userId);
            if (def.configurableDays && days != null) {
                ObjectNode config = JSON.createObjectNode();
                config.put("days", days);
                row.setConfigJson(config.toString());
            }
            mapper.upsert(row);
        }
        return view(workspaceId);
    }

    /** 同一天同一对象只执行一次；先占位再发送，进程重启也不会重复提醒。 */
    public boolean claim(String workspaceId, String ruleKey, String targetKey, LocalDate runDate) {
        try {
            return runMapper.insertIgnore(workspaceId, ruleKey, targetKey, runDate, "sent", null) == 1;
        } catch (Exception e) {
            return false;
        }
    }

    /** 发送失败时撤回当天占位，让下一个整点重试；不是本次占的位不会被删。 */
    public void release(String workspaceId, String ruleKey, String targetKey, LocalDate runDate) {
        try {
            runMapper.deleteClaim(workspaceId, ruleKey, targetKey, runDate);
        } catch (Exception e) {
            // 撤回失败只会导致今天不再重试，不影响规则本身
        }
    }

    public void recordRun(String workspaceId, String ruleKey, String status) {
        try {
            mapper.touchRun(workspaceId, ruleKey, status);
        } catch (Exception ignored) {
            // 执行结果只是诊断信息，写失败不影响规则本身
        }
    }

    public LocalDateTime now() {
        return LocalDateTime.now();
    }
}
