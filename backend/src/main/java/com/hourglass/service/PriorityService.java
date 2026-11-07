package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.PriorityRequest;
import com.hourglass.entity.WorkspacePriority;
import com.hourglass.mapper.WorkspacePriorityMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** 优先级显示配置：档位 code 固定四档（校验/统计/导入口径不变），仅显示名与颜色按空间可配 */
@Service
public class PriorityService {

    public static final List<String> CODES = Arrays.asList("P0", "P1", "P2", "P3");

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Map<String, String> DEFAULT_NAMES = new HashMap<String, String>();
    private static final Map<String, String> DEFAULT_COLORS = new HashMap<String, String>();

    static {
        DEFAULT_NAMES.put("P0", "紧急");
        DEFAULT_NAMES.put("P1", "高");
        DEFAULT_NAMES.put("P2", "中");
        DEFAULT_NAMES.put("P3", "低");
        DEFAULT_COLORS.put("P0", "#F04438");
        DEFAULT_COLORS.put("P1", "#F79009");
        DEFAULT_COLORS.put("P2", "#2E90FA");
        DEFAULT_COLORS.put("P3", "#98A2B3");
    }

    private final WorkspacePriorityMapper priorityMapper;

    public PriorityService(WorkspacePriorityMapper priorityMapper) {
        this.priorityMapper = priorityMapper;
    }

    /** 固定按 P0-P3 顺序返回四档；未配置过的档位用内置默认（不写库） */
    public List<WorkspacePriority> list(String workspaceId) {
        Map<String, WorkspacePriority> configured = new HashMap<String, WorkspacePriority>();
        for (WorkspacePriority row : priorityMapper.selectByWorkspace(workspaceId)) {
            configured.put(row.getCode(), row);
        }
        List<WorkspacePriority> result = new ArrayList<WorkspacePriority>();
        for (String code : CODES) {
            WorkspacePriority row = configured.get(code);
            result.add(row != null ? row : defaultOf(workspaceId, code));
        }
        return result;
    }

    @Transactional
    public WorkspacePriority update(String workspaceId, String code, PriorityRequest req) {
        if (!CODES.contains(code)) {
            throw AppException.badRequest("优先级档位不存在：" + code);
        }
        String name = cleanName(req.getName());
        String color = normalizeColor(code, req.getColor());
        WorkspacePriority row = priorityMapper.selectByCode(workspaceId, code);
        if (row == null) {
            row = defaultOf(workspaceId, code);
            row.setId(Ids.gen("PR"));
            row.setName(name);
            row.setColor(color);
            priorityMapper.insert(row);
        } else {
            row.setName(name);
            row.setColor(color);
            priorityMapper.update(row);
        }
        return priorityMapper.selectByCode(workspaceId, code);
    }

    @Transactional
    public void reset(String workspaceId) {
        priorityMapper.deleteAllByWorkspace(workspaceId);
    }

    private WorkspacePriority defaultOf(String workspaceId, String code) {
        WorkspacePriority row = new WorkspacePriority();
        row.setWorkspaceId(workspaceId);
        row.setCode(code);
        row.setName(DEFAULT_NAMES.get(code));
        row.setColor(DEFAULT_COLORS.get(code));
        return row;
    }

    private String cleanName(String raw) {
        String name = raw == null ? "" : raw.replace(',', ' ').replace('，', ' ').trim();
        name = Texts.cut(name, 12);
        if (name.isEmpty()) {
            throw AppException.badRequest("优先级显示名不能为空");
        }
        return name;
    }

    private String normalizeColor(String code, String color) {
        String c = Texts.trimToNull(color);
        return c != null && COLOR.matcher(c).matches() ? c : DEFAULT_COLORS.get(code);
    }
}
