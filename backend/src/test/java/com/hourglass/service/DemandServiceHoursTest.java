package com.hourglass.service;

import com.hourglass.dto.DemandHoursView;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.MailDeliveryMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TestCaseMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DemandServiceHoursTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final DemandService service = new DemandService(demands, mock(RequirementMapper.class),
            mock(ProjectVersionMapper.class), tasks,
            mock(NotificationEventService.class), mock(RequirementDocMapper.class),
            mock(ProjectAccessService.class), mock(AttachmentService.class),
            mock(MailDeliveryMapper.class), mock(TestCaseMapper.class),
            mock(CategoryMapper.class), mock(DeliveryScopeLock.class),
            mock(ReleasePermissionService.class), mock(DeletionTraceService.class), mock(NumberSeqService.class),
            mock(DemandWatchService.class));

    @Test
    void splitsTestFirstThenProductByStoryAndDevByTaskOrBug() {
        when(demands.selectById("D1")).thenReturn(demand());
        when(tasks.selectHoursByDemand("W1", "D1")).thenReturn(Arrays.asList(
                task("story", 480, null, 360, 0),
                task("task", 600, 180, 420, 120),
                task("bug", null, null, 60, 60),
                task("epic", 999, null, 999, 0),
                task("task", null, null, 0, 0)));

        DemandHoursView hours = service.hours("W1", "U1", "D1");

        /* 史诗整条排除；测试窗口先归测试，需求类剩余归产品，任务 / 缺陷剩余归开发 */
        assertEquals(4, hours.getTaskCount());
        assertEquals(2, hours.getEstimatedCount());
        assertEquals(2, hours.getUnestimatedCount());
        assertEquals(480, hours.getProductEstimateMinutes());
        assertEquals(360, hours.getProductActualMinutes());
        assertEquals(600, hours.getDevEstimateMinutes());
        assertEquals(300, hours.getDevActualMinutes());
        assertEquals(180, hours.getTestEstimateMinutes());
        assertEquals(180, hours.getTestActualMinutes());
        assertEquals(1260, hours.getEstimateMinutes());
        assertEquals(840, hours.getActualMinutes());
    }

    @Test
    void emptyDemandHasNoStages() {
        when(demands.selectById("D1")).thenReturn(demand());
        when(tasks.selectHoursByDemand("W1", "D1")).thenReturn(Collections.emptyList());

        DemandHoursView hours = service.hours("W1", "U1", "D1");

        assertEquals(0, hours.getTaskCount());
        assertEquals(0, hours.getEstimateMinutes());
        assertEquals(0, hours.getActualMinutes());
    }

    private static Demand demand() {
        Demand d = new Demand();
        d.setId("D1");
        d.setWorkspaceId("W1");
        d.setReqId("R1");
        return d;
    }

    private static Task task(String type, Integer estimate, Integer testEstimate, int total, int test) {
        Task t = new Task();
        t.setItemType(type);
        t.setEstimateMinutes(estimate);
        t.setTestEstimateMinutes(testEstimate);
        t.setTotalMinutes(total);
        t.setTestMinutes(test);
        return t;
    }
}
