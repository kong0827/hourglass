package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.service.TaskService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 跨空间「我的任务」（N-3）：一屏看"分派给我的全部待办"。
 *
 * 归属判定优先用 owner_user_id（账号）；历史数据该列为空时回落显示名文本，
 * 因此不需要先跑数据回填也能立即生效（回填脚本 sql/04 可选）。
 */
@RestController
public class MyTasksController {

    private final TaskService taskService;
    private final UserMapper userMapper;

    public MyTasksController(TaskService taskService, UserMapper userMapper) {
        this.taskService = taskService;
        this.userMapper = userMapper;
    }

    @GetMapping("/api/my-tasks")
    public ApiResult<Map<String, Object>> myTasks(@RequestParam(required = false) String scope,
                                                  @RequestParam(required = false) String q,
                                                  @RequestParam(required = false) String pris,
                                                  @RequestParam(required = false) String cats,
                                                  @RequestParam(required = false) String reqs,
                                                  @RequestParam(required = false) String tags,
                                                  @RequestParam(required = false) Boolean blocked) {
        String userId = CurrentUser.id();
        AppUser me = userMapper.selectById(userId);
        String displayName = me == null ? null : Texts.trimToNull(me.getDisplayName());
        boolean openOnly = !"all".equals(scope);

        /* IA-3：接入与看板相同的筛选参数（负责人维度天然固定为"我"） */
        com.devstudio.kanban.dto.BoardQuery query = com.devstudio.kanban.dto.BoardQuery.from(
                q, null, pris, cats, reqs, tags, null, null, blocked, null, null, null, null);
        List<Task> items = taskService.myTasks(userId, displayName, openOnly, query);

        /* 覆盖的空间列表（前端显示"覆盖 N 个空间"） */
        Set<String> wsIds = new LinkedHashSet<String>();
        for (Task t : items) {
            wsIds.add(t.getWorkspaceId());
        }
        List<Map<String, Object>> spaces = new java.util.ArrayList<Map<String, Object>>();
        for (String id : wsIds) {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("id", id);
            String name = null;
            for (Task t : items) {
                if (id.equals(t.getWorkspaceId())) {
                    name = t.getWorkspaceName();
                    break;
                }
            }
            m.put("name", name);
            spaces.add(m);
        }

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("spaces", spaces);
        res.put("matchedByNameOnly", countNameOnly(items, userId));
        return ApiResult.ok(res);
    }

    /** 统计"仅靠显示名匹配、还没绑定账号"的条数，便于用户判断是否需要跑回填脚本 */
    private int countNameOnly(List<Task> items, String userId) {
        int n = 0;
        for (Task t : items) {
            if (t.getOwnerUserId() == null || !userId.equals(t.getOwnerUserId())) {
                n++;
            }
        }
        return n;
    }
}
