package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.GitLabClient;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.ProjectRepo;
import com.hourglass.mapper.DevBranchAliasMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectRepoMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GitSyncServiceTest {

    private static final String WS = "W1";
    private static final String REPO = "R1";
    private static final String PROJECT = "P1";

    @Mock private ProjectRepoMapper repoMapper;
    @Mock private DevBranchMapper branchMapper;
    @Mock private DevBranchAliasMapper aliasMapper;
    @Mock private UserMapper userMapper;
    @Mock private RepoService repoService;
    @Mock private ProjectAccessService projectAccess;
    @Mock private GitLabClient gitLab;

    private GitSyncService service;
    private ProjectRepo repo;

    @BeforeEach
    void setUp() {
        service = new GitSyncService(repoMapper, branchMapper, aliasMapper, userMapper,
                repoService, projectAccess, gitLab);
        repo = new ProjectRepo();
        repo.setId(REPO);
        repo.setWorkspaceId(WS);
        repo.setReqId(PROJECT);
        repo.setRepoUrl("https://gitlab.example.com");
        repo.setProjectRef("group/project");
        repo.setDefaultTarget("main");
        repo.setImportPolicy("recent90");
        when(repoService.tokenOf(repo)).thenReturn("token");
    }

    @Test
    void adoptsExistingManualBranchInsteadOfCreatingDuplicate() {
        GitLabClient.RemoteBranch rb = remote("feature/x", "sha1", LocalDateTime.now().minusDays(1));
        when(gitLab.listBranches(anyString(), anyString(), anyString()))
                .thenReturn(Collections.singletonList(rb));
        when(gitLab.listMergedMrs(anyString(), anyString(), anyString()))
                .thenReturn(Collections.<GitLabClient.MergedMr>emptyList());
        when(branchMapper.selectByRepo(WS, REPO)).thenReturn(Collections.<DevBranch>emptyList());

        DevBranch manual = new DevBranch();
        manual.setId("B1");
        manual.setWorkspaceId(WS);
        manual.setReqId(PROJECT);
        manual.setName("feature/x");
        manual.setStatus("dev");
        manual.setOutcome(BranchLifecycleRules.OUTCOME_OPEN);
        when(branchMapper.selectManualByName(WS, PROJECT, "feature/x")).thenReturn(manual);

        GitSyncService.SyncSummary summary = service.syncRepo(repo);

        assertEquals(1, summary.adopted);
        assertEquals(0, summary.created);
        verify(branchMapper).adoptToRepo(eq(WS), eq("B1"), eq(REPO), eq("sha1"),
                any(LocalDateTime.class), any(), any(LocalDateTime.class), eq("sha1"));
        verify(branchMapper, never()).insertGitBranch(any(DevBranch.class));
    }

    @Test
    void renameReusesOldBranchAndRecordsAlias() {
        LocalDateTime now = LocalDateTime.now();
        DevBranch old = tracked("B1", "feature/old", BranchLifecycleRules.REMOTE_ACTIVE, "sha9");
        old.setLastSeenHeadSha("sha9");
        old.setLastSeenAt(now.minusMinutes(5));
        when(branchMapper.selectByRepo(WS, REPO)).thenReturn(Collections.singletonList(old));

        GitLabClient.RemoteBranch renamed = remote("feature/new", "sha9", now);
        when(gitLab.listBranches(anyString(), anyString(), anyString()))
                .thenReturn(Collections.singletonList(renamed));
        when(gitLab.listMergedMrs(anyString(), anyString(), anyString()))
                .thenReturn(Collections.<GitLabClient.MergedMr>emptyList());

        GitSyncService.SyncSummary summary = service.syncRepo(repo);

        assertEquals(1, summary.renamed);
        verify(branchMapper).renameById(WS, "B1", "feature/new");
        verify(aliasMapper).insert(any(com.hourglass.entity.DevBranchAlias.class));
        verify(branchMapper, never()).insertGitBranch(any(DevBranch.class));
    }

    @Test
    void disappearedUnmergedBranchTurnsPending() {
        DevBranch b = tracked("B1", "feature/gone", BranchLifecycleRules.REMOTE_ACTIVE, "sha1");
        when(branchMapper.selectByRepo(WS, REPO)).thenReturn(Collections.singletonList(b));
        when(gitLab.listBranches(anyString(), anyString(), anyString()))
                .thenReturn(Collections.<GitLabClient.RemoteBranch>emptyList());
        when(gitLab.listMergedMrs(anyString(), anyString(), anyString()))
                .thenReturn(Collections.<GitLabClient.MergedMr>emptyList());
        doAnswer(inv -> {
            b.setRemoteState(BranchLifecycleRules.REMOTE_DELETED);
            return 1;
        }).when(branchMapper).markRemoteDeleted(WS, "B1");

        GitSyncService.SyncSummary summary = service.syncRepo(repo);

        assertEquals(1, summary.disappeared);
        assertEquals(1, summary.pending);
        verify(branchMapper).updateOutcome(WS, "B1",
                BranchLifecycleRules.OUTCOME_PENDING, BranchLifecycleRules.PENDING_DISAPPEARED);
    }

    @Test
    void closedBranchWithNewCommitBecomesPendingButKeepsDecision() {
        LocalDateTime now = LocalDateTime.now();
        DevBranch b = tracked("B1", "feature/revived", BranchLifecycleRules.REMOTE_ACTIVE, "sha2");
        b.setOutcome(BranchLifecycleRules.OUTCOME_CANCELED);
        b.setDecision(BranchLifecycleRules.OUTCOME_CANCELED);
        b.setDecidedAt(now.minusDays(1));
        when(branchMapper.selectByRepo(WS, REPO)).thenReturn(Collections.singletonList(b));

        GitLabClient.RemoteBranch rb = remote("feature/revived", "sha3", now.minusHours(2));
        when(gitLab.listBranches(anyString(), anyString(), anyString()))
                .thenReturn(Collections.singletonList(rb));
        when(gitLab.listMergedMrs(anyString(), anyString(), anyString()))
                .thenReturn(Collections.<GitLabClient.MergedMr>emptyList());
        doAnswer(inv -> {
            b.setRemoteHeadSha("sha3");
            b.setRemoteHeadAt(now.minusHours(2));
            return 1;
        }).when(branchMapper).updateRemoteFacts(eq(WS), eq("B1"), anyString(),
                anyString(), any(), any(), any(LocalDateTime.class), anyString());

        service.syncRepo(repo);

        verify(branchMapper).updateOutcome(WS, "B1",
                BranchLifecycleRules.OUTCOME_PENDING, BranchLifecycleRules.PENDING_CLOSED_NEW_COMMIT);
        verify(branchMapper, never()).clearDecision(anyString(), anyString());
    }

    @Test
    void fetchFailureOnlyWritesSyncErrorAndLeavesFactsUntouched() {
        when(gitLab.listBranches(anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("boom"));

        assertThrows(AppException.class, () -> service.syncRepo(repo));

        verify(repoMapper).updateSyncResult(eq(WS), eq(REPO), eq("error"), anyString(),
                eq(null), any(LocalDateTime.class));
        verify(branchMapper).updateSyncState(eq(WS), eq(REPO), eq("error"), anyString());
        verify(branchMapper, never()).markRemoteDeleted(anyString(), anyString());
        verify(branchMapper, never()).updateRemoteFacts(anyString(), anyString(), anyString(),
                anyString(), any(), any(), any(LocalDateTime.class), anyString());
        verify(branchMapper, never()).updateOutcome(anyString(), anyString(), anyString(), any());
        verify(branchMapper, never()).insertGitBranch(any(DevBranch.class));
    }

    private static DevBranch tracked(String id, String name, String remoteState, String sha) {
        DevBranch b = new DevBranch();
        b.setId(id);
        b.setWorkspaceId(WS);
        b.setReqId(PROJECT);
        b.setRepoId(REPO);
        b.setName(name);
        b.setStatus("dev");
        b.setOutcome(BranchLifecycleRules.OUTCOME_OPEN);
        b.setRemoteState(remoteState);
        b.setRemoteHeadSha(sha);
        b.setMerged(Boolean.FALSE);
        b.setLastSeenAt(LocalDateTime.now().minusMinutes(5));
        b.setLastSeenHeadSha(sha);
        return b;
    }

    private static GitLabClient.RemoteBranch remote(String name, String sha, LocalDateTime at) {
        GitLabClient.RemoteBranch rb = new GitLabClient.RemoteBranch();
        rb.name = name;
        rb.sha = sha;
        rb.committedAt = at;
        rb.author = "dev";
        return rb;
    }
}
