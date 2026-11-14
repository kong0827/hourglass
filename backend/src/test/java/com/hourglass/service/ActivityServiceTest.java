package com.hourglass.service;

import com.hourglass.dto.ActivityFeed;
import com.hourglass.dto.ActivityFeedItem;
import com.hourglass.dto.ActivityQuery;
import com.hourglass.dto.ActivityTypeCount;
import com.hourglass.mapper.ActivityFeedMapper;
import com.hourglass.mapper.TaskLogMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ActivityServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final ActivityFeedMapper feedMapper = mock(ActivityFeedMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ActivityService service =
            new ActivityService(mock(TaskLogMapper.class), feedMapper, access);

    private static ActivityTypeCount count(String type, int total) {
        ActivityTypeCount c = new ActivityTypeCount();
        c.setType(type);
        c.setTotal(total);
        return c;
    }

    @Test
    void privilegedSeesConfigAndAllCounts() {
        when(access.roleOf(WS, USER)).thenReturn("owner");
        when(access.viewerScope(WS, USER)).thenReturn(null);
        when(feedMapper.countByType(WS, null, USER, true, true, null, null, null, null, null))
                .thenReturn(Arrays.asList(count("task", 3), count("demand", 1), count("config", 2)));
        when(feedMapper.selectFeed(WS, null, USER, true, true, null, null, null, null, null, null, 0, 50))
                .thenReturn(Collections.singletonList(new ActivityFeedItem()));

        ActivityFeed feed = service.feed(WS, USER, (String) null, 0, 50);

        assertEquals(6, feed.getTotal());
        assertEquals(6, feed.getCounts().get("all"));
        assertEquals(2, feed.getCounts().get("config"));
        assertEquals(0, feed.getCounts().get("version"), "缺失类型补 0，前端 chips 不跳变");
        assertTrue(feed.isHasMore());
        verify(feedMapper).selectFeed(WS, null, USER, true, true, null, null, null, null, null, null, 0, 50);
    }

    @Test
    void memberCannotSeeConfigEvenIfMapperReturnsIt() {
        when(access.roleOf(WS, USER)).thenReturn("member");
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(feedMapper.countByType(WS, USER, USER, false, false, null, null, null, null, null))
                .thenReturn(Arrays.asList(count("task", 2), count("config", 4)));

        ActivityFeed feed = service.feed(WS, USER, "config", 0, 50);

        assertEquals(0, feed.getTotal(), "普通成员请求配置类型也只能拿到空页");
        assertFalse(feed.getCounts().containsKey("config"));
        assertEquals(2, feed.getCounts().get("all"), "配置条数不计入总数");
        assertTrue(feed.getItems().isEmpty());
        verify(feedMapper, never()).selectFeed(anyString(), anyString(), anyString(),
                anyBoolean(), anyBoolean(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyInt(), anyInt());
    }

    @Test
    void typeFilterUsesCountAndSkipsQueryPastEnd() {
        when(access.roleOf(WS, USER)).thenReturn("admin");
        when(access.viewerScope(WS, USER)).thenReturn(null);
        when(feedMapper.countByType(WS, null, USER, true, true, null, null, null, null, null))
                .thenReturn(Arrays.asList(count("task", 2), count("demand", 9)));

        ActivityFeed feed = service.feed(WS, USER, "task", 2, 50);

        assertEquals(2, feed.getTotal());
        assertFalse(feed.isHasMore());
        assertTrue(feed.getItems().isEmpty());
        verify(feedMapper, never()).selectFeed(anyString(), anyString(), anyString(),
                anyBoolean(), anyBoolean(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyInt(), anyInt());
    }

    @Test
    void filtersAreTrimmedAndPassedToBothQueries() {
        when(access.roleOf(WS, USER)).thenReturn("owner");
        when(access.viewerScope(WS, USER)).thenReturn(null);
        when(feedMapper.countByType(WS, null, USER, true, true,
                "share", "U9", "2026-11-01", "2026-11-14", "支付"))
                .thenReturn(Collections.singletonList(count("doc", 1)));
        when(feedMapper.selectFeed(WS, null, USER, true, true, "doc",
                "share", "U9", "2026-11-01", "2026-11-14", "支付", 0, 50))
                .thenReturn(Collections.singletonList(new ActivityFeedItem()));

        ActivityQuery query = new ActivityQuery();
        query.setType("doc");
        query.setAction("  share  ");
        query.setActorId(" U9 ");
        query.setFromDate("2026-11-01");
        query.setToDate("2026-11-14");
        query.setKeyword(" 支付 ");
        ActivityFeed feed = service.feed(WS, USER, query, 0, 50);

        assertEquals(1, feed.getTotal(), "总数按筛选后的计数计算");
        verify(feedMapper).selectFeed(WS, null, USER, true, true, "doc",
                "share", "U9", "2026-11-01", "2026-11-14", "支付", 0, 50);
    }

    @Test
    void invalidDatesAreDroppedAndKeywordCut() {
        when(access.roleOf(WS, USER)).thenReturn("owner");
        when(access.viewerScope(WS, USER)).thenReturn(null);
        String longKeyword = "0123456789012345678901234567890123456789012345678901234567890";
        when(feedMapper.countByType(WS, null, USER, true, true,
                null, null, null, null, longKeyword.substring(0, 50)))
                .thenReturn(Collections.singletonList(count("task", 2)));

        ActivityQuery query = new ActivityQuery();
        query.setFromDate("2026-11-31");
        query.setToDate("2026-13-99");
        query.setKeyword(longKeyword);
        ActivityFeed feed = service.feed(WS, USER, query, 0, 50);

        assertEquals(2, feed.getTotal());
        verify(feedMapper).countByType(WS, null, USER, true, true,
                null, null, null, null, longKeyword.substring(0, 50));
    }

    @Test
    void unknownTypeFallsBackToAllAndClampsPaging() {
        when(access.roleOf(WS, USER)).thenReturn("owner");
        when(access.viewerScope(WS, USER)).thenReturn(null);
        when(feedMapper.countByType(WS, null, USER, true, true, null, null, null, null, null))
                .thenReturn(Collections.singletonList(count("task", 1)));
        when(feedMapper.selectFeed(WS, null, USER, true, true, null, null, null, null, null, null, 0, 100))
                .thenReturn(Collections.singletonList(new ActivityFeedItem()));

        ActivityFeed feed = service.feed(WS, USER, "bogus", -5, 500);

        assertEquals(1, feed.getTotal());
        assertEquals(0, feed.getOffset());
        assertEquals(100, feed.getLimit());
        verify(feedMapper).selectFeed(eq(WS), isNull(), eq(USER), eq(true), eq(true),
                isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), eq(0), eq(100));
    }
}
