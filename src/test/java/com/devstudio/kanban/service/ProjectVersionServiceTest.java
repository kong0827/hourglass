package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.ProjectVersionSaveRequest;
import com.devstudio.kanban.entity.ProjectVersion;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.VersionTaskMapper;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectVersionServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final VersionTaskMapper versionTasks = mock(VersionTaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final ProjectVersionService service =
            new ProjectVersionService(versions, versionTasks, reqs, demands, access);

    @Test
    void deleteClearsDemandReferencesBeforeRemovingVersion() {
        when(versions.selectById("V1")).thenReturn(version("V1", "R1"));

        service.delete(USER, WS, "V1");

        InOrder order = inOrder(versionTasks, demands, versions);
        order.verify(versionTasks).deleteByVersion(WS, "V1");
        order.verify(demands).clearVersionRefsByVersion(WS, "V1");
        order.verify(versions).deleteById(WS, "V1");
        verify(access).assertWrite(WS, USER, "R1");
    }

    @Test
    void publishSkipsAlreadyReleasedVersion() {
        ProjectVersion released = version("V1", "R1");
        released.setStatus("released");
        when(versions.selectById("V1")).thenReturn(released);

        ProjectVersion result = service.publish(USER, WS, "V1");

        assertSame(released, result);
        verify(versions, never()).release(anyString(), anyString());
    }

    @Test
    void createRejectsTaskThatDoesNotBelongToProject() {
        when(reqs.selectById("R1")).thenReturn(requirement("R1"));
        when(versions.countByName(WS, "R1", "V1.0", null)).thenReturn(0);
        when(versionTasks.selectOptionsByReq(WS, "R1")).thenReturn(Collections.emptyList());

        ProjectVersionSaveRequest request = new ProjectVersionSaveRequest();
        request.setReqId("R1");
        request.setName("V1.0");
        request.setTaskIds(Collections.singletonList("T9"));

        AppException error = assertThrows(AppException.class, () -> service.create(USER, WS, request));

        assertEquals(400, error.getCode());
        verify(versionTasks, never()).deleteByVersion(anyString(), anyString());
        verify(versionTasks, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @Test
    void rejectsDuplicateVersionNameWithinProject() {
        when(reqs.selectById("R1")).thenReturn(requirement("R1"));
        when(versions.countByName(WS, "R1", "V1.0", null)).thenReturn(1);

        ProjectVersionSaveRequest request = new ProjectVersionSaveRequest();
        request.setReqId("R1");
        request.setName("V1.0");

        AppException error = assertThrows(AppException.class, () -> service.create(USER, WS, request));

        assertEquals(400, error.getCode());
        verify(versions, never()).insert(any(ProjectVersion.class));
    }

    private ProjectVersion version(String id, String reqId) {
        ProjectVersion v = new ProjectVersion();
        v.setId(id);
        v.setWorkspaceId(WS);
        v.setReqId(reqId);
        v.setName(id);
        v.setStatus("active");
        return v;
    }

    private Requirement requirement(String id) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setName("项目");
        return r;
    }
}
