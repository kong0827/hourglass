package com.hourglass.dto;

import com.hourglass.entity.Task;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 已取消视图：明细 + 原因计数。
 *
 * <p>终态不占看板列，所以不复用 BoardResponse.ColumnData（那里没有原因分布）；
 * 原因计数直接下发给筛选 chip，避免前端再按当前页统计（分页后必然不准）。
 */
@Data
public class TaskCanceledPage {

    private List<Task> items = new ArrayList<Task>();

    /** 全部已取消条数（不受原因筛选影响） */
    private int total;

    /** 当前原因筛选后的条数 */
    private int matched;

    private boolean hasMore;

    /** 原因计数：name=原因码，count=条数 */
    private List<BoardResponse.NameCount> reasons = new ArrayList<BoardResponse.NameCount>();
}
