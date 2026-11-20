package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.config.WorkspaceCtx;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.dto.MyDemandQuery;
import com.hourglass.service.MyWorkService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 「我的工作」多角色个人工作台：页签计数与需求队列。
 *
 * <p>工作项仍走 /api/my-tasks（跨空间），这里只补需求侧；
 * 需求与评审按当前空间，关注关系读 demand_watch。
 */
@RestController
public class MyWorkController {

    private final MyWorkService myWorkService;

    public MyWorkController(MyWorkService myWorkService) {
        this.myWorkService = myWorkService;
    }

    /** 页签徽标：待我处理（工作项并集 + 待评审）/ 我发起的 / 我关注的 */
    @GetMapping("/api/my-work/counts")
    public ApiResult<Map<String, Object>> counts(@CurrentWorkspace WorkspaceCtx ctx) {
        return ApiResult.ok(myWorkService.counts(ctx.getWsId(), ctx.getUserId()));
    }

    /** 我发起的 / 我关注的 / 待我评审：分页、关键词、优先级与项目筛选 */
    @GetMapping("/api/my-demands")
    public ApiResult<Map<String, Object>> demands(@RequestParam(required = false) String view,
                                                  @RequestParam(required = false) String status,
                                                  @RequestParam(required = false) String q,
                                                  @RequestParam(required = false) String pris,
                                                  @RequestParam(required = false) String reqs,
                                                  @RequestParam(required = false) String sort,
                                                  @RequestParam(required = false) Integer offset,
                                                  @RequestParam(required = false) Integer limit,
                                                  @CurrentWorkspace WorkspaceCtx ctx) {
        MyDemandQuery query = new MyDemandQuery();
        query.setView(view);
        query.setStatus(status);
        query.setQ(com.hourglass.common.Texts.trimToNull(q));
        query.setPris(splitCsv(pris));
        query.setReqs(splitCsv(reqs));
        query.setSort(sort);
        query.setOffset(offset == null ? 0 : offset);
        query.setLimit(limit == null ? 20 : limit);
        return ApiResult.ok(myWorkService.demands(ctx.getWsId(), ctx.getUserId(), query));
    }

    private static List<String> splitCsv(String v) {
        List<String> list = new ArrayList<String>();
        if (v == null || v.trim().isEmpty()) {
            return list;
        }
        for (String part : v.split(",")) {
            String s = part.trim();
            if (!s.isEmpty()) {
                list.add(s);
            }
        }
        return list;
    }
}
