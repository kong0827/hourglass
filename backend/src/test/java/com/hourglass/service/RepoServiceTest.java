package com.hourglass.service;

import com.hourglass.common.AiCrypto;
import com.hourglass.common.AppException;
import com.hourglass.dto.RepoSaveRequest;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.ProjectRepo;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectRepoMapper;
import com.hourglass.mapper.RequirementMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RepoServiceTest {

    private static final String WS = "W1";
    private static final String PROJECT = "P1";
    private static final String URL = "https://localhost:8443";

    @Mock private ProjectRepoMapper repoMapper;
    @Mock private DevBranchMapper branchMapper;
    @Mock private RequirementMapper requirementMapper;
    @Mock private ProjectAccessService projectAccess;
    @Mock private AiCrypto aiCrypto;

    private RepoService service;

    @BeforeEach
    void setUp() {
        /* allowPrivate=true：localhost 可解析，测试不依赖外网 DNS */
        service = new RepoService(repoMapper, branchMapper, requirementMapper,
                projectAccess, aiCrypto, true);
        Requirement req = new Requirement();
        req.setId(PROJECT);
        req.setWorkspaceId(WS);
        req.setName("项目一");
        when(requirementMapper.selectById(PROJECT)).thenReturn(req);
    }

    @Test
    void sameSiteDifferentProjectRefIsAllowed() {
        service.create("U1", WS, request("group/two"));

        verify(repoMapper).selectByWorkspaceAndUrl(WS, URL, "group/two");
        verify(repoMapper).insert(any(ProjectRepo.class));
    }

    @Test
    void sameSiteAndSameProjectRefIsRejected() {
        ProjectRepo existing = new ProjectRepo();
        existing.setId("R1");
        existing.setWorkspaceId(WS);
        existing.setRepoUrl(URL);
        existing.setProjectRef("group/one");
        when(repoMapper.selectByWorkspaceAndUrl(WS, URL, "group/one")).thenReturn(existing);

        AppException ex = assertThrows(AppException.class,
                () -> service.create("U1", WS, request("group/one")));
        assertEquals(400, ex.getCode());
        verify(repoMapper, never()).insert(any(ProjectRepo.class));
    }

    @Test
    void projectRefIsTrimmedBeforeUniquenessCheck() {
        when(repoMapper.selectByWorkspaceAndUrl(WS, URL, "group/one")).thenReturn(null);

        service.create("U1", WS, request("/group/one/"));

        verify(repoMapper).selectByWorkspaceAndUrl(eq(WS), eq(URL), eq("group/one"));
    }

    @Test
    void remoteIdentityCannotChangeWhenBranchesExist() {
        ProjectRepo repo = new ProjectRepo();
        repo.setId("R1");
        repo.setWorkspaceId(WS);
        repo.setReqId(PROJECT);
        repo.setRepoUrl(URL);
        repo.setProjectRef("group/one");
        when(repoMapper.selectById("R1")).thenReturn(repo);
        when(branchMapper.selectByRepo(WS, "R1")).thenReturn(Collections.singletonList(new DevBranch()));

        AppException ex = assertThrows(AppException.class,
                () -> service.update("U1", WS, "R1", request("group/two")));
        assertEquals(400, ex.getCode());
        verify(repoMapper, never()).update(any(ProjectRepo.class));
    }

    private RepoSaveRequest request(String projectRef) {
        RepoSaveRequest req = new RepoSaveRequest();
        req.setReqId(PROJECT);
        req.setRepoUrl(URL);
        req.setProjectRef(projectRef);
        req.setImportPolicy("manual");
        return req;
    }
}
