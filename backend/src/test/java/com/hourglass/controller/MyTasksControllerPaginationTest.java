package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.LoginUser;
import com.hourglass.dto.MyTaskWorkspace;
import com.hourglass.dto.MyTasksPage;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Task;
import com.hourglass.mapper.UserMapper;
import com.hourglass.service.TaskQueryService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** TOP-6：/api/my-tasks 的 offset/limit 收敛与 total / hasMore 计算。 */
class MyTasksControllerPaginationTest {

    private TaskQueryService queryService;
    private MyTasksController controller;

    @BeforeEach
    void setUp() {
        queryService = mock(TaskQueryService.class);
        UserMapper userMapper = mock(UserMapper.class);
        AppUser me = new AppUser();
        me.setId("U1");
        me.setDisplayName("我");
        when(userMapper.selectById("U1")).thenReturn(me);
        controller = new MyTasksController(queryService, userMapper);

        LoginUser user = new LoginUser("U1", "u1", "x", "我", "user");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void defaultsToFirstPageAndReportsHasMore() {
        Task t1 = task("K1");
        Task t2 = task("K2");
        MyTaskWorkspace ws = new MyTaskWorkspace();
        ws.setId("W1");
        ws.setName("空间一");
        when(queryService.myTasksPage(eq("U1"), eq("我"), eq(true), any(), eq(0), eq(100)))
                .thenReturn(new MyTasksPage(Arrays.asList(t1, t2), 10,
                        Collections.singletonList(ws), 1));

        ApiResult<Map<String, Object>> res = controller.myTasks(null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null);

        Map<String, Object> data = res.getData();
        assertEquals(10, data.get("total"));
        assertEquals(0, data.get("offset"));
        assertEquals(100, data.get("limit"));
        assertEquals(Boolean.TRUE, data.get("hasMore"));
        assertEquals(Boolean.TRUE, data.get("truncated"));
        List<?> spaces = (List<?>) data.get("spaces");
        assertEquals(1, spaces.size());
        assertEquals("空间一", ((Map<?, ?>) spaces.get(0)).get("name"));
        assertEquals(1, data.get("matchedByNameOnly"));
    }

    @Test
    void clampsLimitAndNegativeOffset() {
        when(queryService.myTasksPage(eq("U1"), eq("我"), eq(true), any(), eq(0), eq(100)))
                .thenReturn(new MyTasksPage(Collections.<Task>emptyList(), 0,
                        Collections.<MyTaskWorkspace>emptyList(), 0));

        Map<String, Object> data = controller.myTasks(null, null, null, null, null, null,
                null, null, null, null, null, null, null, -3, 9999).getData();

        assertEquals(0, data.get("offset"));
        assertEquals(100, data.get("limit"));
        assertEquals(Boolean.FALSE, data.get("hasMore"));
        verify(queryService).myTasksPage(eq("U1"), eq("我"), eq(true), any(), eq(0), eq(100));
    }

    @Test
    void lastPageHasNoMore() {
        when(queryService.myTasksPage(eq("U1"), eq("我"), eq(true), any(), eq(4), eq(100)))
                .thenReturn(new MyTasksPage(Collections.singletonList(task("K5")), 5,
                        Collections.<MyTaskWorkspace>emptyList(), 0));

        Map<String, Object> data = controller.myTasks(null, null, null, null, null, null,
                null, null, null, null, null, null, null, 4, 100).getData();

        assertEquals(Boolean.FALSE, data.get("hasMore"));
    }

    private static Task task(String id) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId("W1");
        return t;
    }
}
