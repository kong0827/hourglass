package com.hourglass.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

/** 空间活动聚合页：分页 + 各实体类型条数（配置项只在有权限时出现）。 */
@Data
public class ActivityFeed {

    private int total;
    private int offset;
    private int limit;
    private boolean hasMore;
    private List<ActivityFeedItem> items;
    /** key: all/task/demand/project/doc/branch/version/config */
    private Map<String, Integer> counts;

    public static ActivityFeed of(List<ActivityFeedItem> items, int total, int offset, int limit,
                                  Map<String, Integer> counts) {
        ActivityFeed feed = new ActivityFeed();
        feed.setTotal(total);
        feed.setOffset(offset);
        feed.setLimit(limit);
        feed.setItems(items);
        feed.setHasMore(offset + items.size() < total);
        feed.setCounts(counts);
        return feed;
    }
}
