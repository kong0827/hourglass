package com.hourglass.service;

import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** sql/124：工作项建单时写入创建人，「我发起的」据此跨项目跟踪。 */
class TaskCreatorTest {

    private static final String WS = "W1";

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final TaskCommandService service = new TaskCommandService(tasks, reqs,
            mock(SubtaskMapper.class), mock(CategoryMapper.class), mock(UserMapper.class), mock(RequirementDocMapper.class),
            mock(DevBranchMapper.class), mock(WorkspaceMemberMapper.class), mock(ProjectVersionMapper.class),
            mock(VersionTaskMapper.class), mock(DemandMapper.class), mock(WorkspaceMetaCache.class),
            mock(TaskSupport.class), mock(TaskCompletionService.class), mock(TaskWorkflowService.class),
            mock(TaskAuditLogger.class), mock(NotificationEventService.class), mock(ProjectAccessService.class),
            mock(TimeLogService.class), mock(DeliveryScopeLock.class), mock(ReleasePermissionService.class),
            mock(DemandCompletionService.class));

    @Test
    void createStoresCurrentUserAsCreator() {
        Requirement r = new Requirement();
        r.setId("R1");
        r.setWorkspaceId(WS);
        r.setName("项目");
        when(reqs.selectById("R1")).thenReturn(r);
        TaskSaveRequest req = new TaskSaveRequest();
        req.setTitle("工作项标题");
        req.setReqId("R1");
        req.setBoardColumn("backlog");
        req.setPriority("P2");
        req.setProgress(0);

        service.create("U9", WS, req);

        ArgumentCaptor<Task> saved = ArgumentCaptor.forClass(Task.class);
        verify(tasks).insert(saved.capture());
        assertEquals("U9", saved.getValue().getCreatedByUserId());
    }
}
