package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.Texts;
import com.hourglass.dto.MyTaskWorkspace;
import com.hourglass.dto.MyTasksPage;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.TaskQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 跨空间「我的任务」（N-3）：一屏看"分派给我的全部待办"。
 *
 * 归属判定优先用 owner_user_id（账号）；历史数据该列为空时回落显示名文本，
 * 因此不需要先跑数据回填也能立即生效（回填脚本 sql/04 可选）。
 *
 * TOP-6：结果改为分页（offset/limit，默认 0/200、上限 500），返回全量 total 与 hasMore；
 * total / 覆盖空间 / 仅显示名匹配数都按筛选后的全量统计，分页不会让统计缩水。
 */
@RestController
public class MyTasksController {

    private static final int DEFAULT_LIMIT = 200;

    private final TaskQueryService taskService;
    private final UserMapper userMapper;

    public MyTasksController(TaskQueryService taskService, UserMapper userMapper) {
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
                                                  @RequestParam(required = false) String types,
                                                  @RequestParam(required = false) String versions,
                                                  @RequestParam(required = false) Boolean blocked,
                                                  @RequestParam(required = false) String due,
                                                  @RequestParam(required = false) Boolean focus,
                                                  @RequestParam(required = false) Integer offset,
                                                  @RequestParam(required = false) Integer limit) {
        String userId = CurrentUser.id();
        AppUser me = userMapper.selectById(userId);
        String displayName = me == null ? null : Texts.trimToNull(me.getDisplayName());
        boolean openOnly = !"all".equals(scope);

        /* IA-3：接入与看板相同的筛选参数（负责人维度天然固定为"我"） */
        com.hourglass.dto.BoardQuery query = com.hourglass.dto.BoardQuery.from(
                q, null, pris, cats, reqs, tags, types, versions, due, focus, blocked, null, null, null, null);
        int off = offset == null ? 0 : Math.max(0, offset);
        int lim = limit == null ? DEFAULT_LIMIT
                : Math.max(1, Math.min(TaskQueryService.MY_TASKS_MAX_LIMIT, limit));
        MyTasksPage page = taskService.myTasksPage(userId, displayName, openOnly, query, off, lim);
        int loaded = off + page.getItems().size();
        /* 空页时不能继续 hasMore=true：COUNT 与列表之间被删会导致客户端 offset 不前进 */
        boolean hasMore = !page.getItems().isEmpty() && loaded < page.getTotal();

        /* 覆盖的空间列表（前端显示"覆盖 N 个空间"）：全量统计，不是本页 */
        List<Map<String, Object>> spaces = new ArrayList<Map<String, Object>>();
        for (MyTaskWorkspace ws : page.getSpaces()) {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("id", ws.getId());
            m.put("name", ws.getName());
            spaces.add(m);
        }

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", page.getItems());
        res.put("total", page.getTotal());
        res.put("offset", off);
        res.put("limit", lim);
        res.put("hasMore", hasMore);
        /* 兼容字段：旧前端用它提示"只显示前 200 项"，语义等同 hasMore */
        res.put("truncated", hasMore);
        res.put("spaces", spaces);
        res.put("matchedByNameOnly", page.getNameOnly());
        return ApiResult.ok(res);
    }
}
