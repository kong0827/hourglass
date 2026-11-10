package com.hourglass.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.dto.*;
import com.hourglass.entity.*;
import com.hourglass.mapper.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class VersionReleaseServiceTest {
    private final ReleaseMapper mapper = mock(ReleaseMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final DeliveryScopeLock locks = mock(DeliveryScopeLock.class);
    private final NotificationEventService notifications = mock(NotificationEventService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final VersionReleaseService service = new VersionReleaseService(mapper, versions, mock(RequirementMapper.class),
            mock(DemandMapper.class), users, members, locks, permissions, access,
            mock(TaskPublicationService.class), notifications, json, tx);
    private final Map<String, VersionReleasePlan> plans = new HashMap<String, VersionReleasePlan>();
    private final Map<String, VersionRelease> records = new HashMap<String, VersionRelease>();
    private final Map<String, List<VersionReleaseItem>> items = new HashMap<String, List<VersionReleaseItem>>();
    private final List<Task> scope = new ArrayList<Task>();
    private final List<TaskVersionBinding> bindings = new ArrayList<TaskVersionBinding>();
    private ProjectVersion version;
    private static final OffsetDateTime TIME = OffsetDateTime.now(ZoneOffset.UTC).minusDays(2).withNano(0);
    private static final String DIGEST = String.join("", Collections.nCopies(64, "a"));

    @BeforeEach void setup() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        version = new ProjectVersion(); version.setId("V"); version.setWorkspaceId("W"); version.setReqId("P");
        version.setName("1.0"); version.setRevision(0L); version.setStatus("active");
        when(versions.selectById("V")).thenReturn(version);
        when(versions.selectByIdForUpdate("W", "V")).thenReturn(version);
        when(members.selectDeliveryAccessForUpdate(eq("W"), anyString(), isNull())).thenReturn(Collections.singletonMap("role", "admin"));
        Requirement project = new Requirement(); project.setId("P"); project.setWorkspaceId("W"); project.setName("Project");
        when(mapper.selectProjectForUpdate("W", "P")).thenReturn(project);
        AppUser actor = new AppUser(); actor.setDisplayName("Recorder"); when(users.selectById("U")).thenReturn(actor);
        AppUser executor = new AppUser(); executor.setDisplayName("Executor"); when(users.selectById("E")).thenReturn(executor);
        scope.add(task("T1")); scope.add(task("T2"));
        when(mapper.selectScope("W", "V")).thenAnswer(i -> scope);
        bindings.add(binding("T1", "V", "1.0")); bindings.add(binding("T2", "V", "1.0"));
        when(mapper.selectTaskVersionRowsForUpdate(eq("W"), anyList())).thenAnswer(i -> {
            List<String> ids = i.getArgument(1);
            return bindings.stream().filter(row -> ids.contains(row.getTaskId())).collect(java.util.stream.Collectors.toList());
        });
        when(mapper.selectTaskForUpdate(eq("W"), anyString())).thenAnswer(i -> scope.stream().filter(t -> t.getId().equals(i.getArgument(1))).findFirst().orElse(null));
        when(mapper.selectPlanForUpdate(eq("W"), anyString())).thenAnswer(i -> plans.get(i.getArgument(1)));
        when(mapper.selectPlannedTaskIdsForUpdate(eq("W"), anyString())).thenAnswer(i -> new ArrayList<String>(plans.get(i.getArgument(1)).getPlannedTaskIds()));
        when(mapper.insertPlan(any())).thenAnswer(i -> { VersionReleasePlan p = i.getArgument(0); plans.put(p.getId(), p); return 1; });
        when(mapper.updatePlan(any())).thenAnswer(i -> { VersionReleasePlan p = i.getArgument(0); p.setRevision(p.getRevision() + 1); plans.put(p.getId(), p); return 1; });
        when(mapper.insertPlanTask(anyString(), anyString(), anyString())).thenReturn(1);
        when(mapper.completePlan(eq("W"), anyString(), anyLong())).thenAnswer(i -> { VersionReleasePlan p = plans.get(i.getArgument(1)); p.setStatus("completed"); p.setRevision(p.getRevision() + 1); return 1; });
        when(mapper.selectByKeyForUpdate(eq("W"), eq("V"), anyString())).thenAnswer(i -> records.get(i.getArgument(2)));
        when(mapper.insertRecord(any())).thenAnswer(i -> { VersionRelease r = i.getArgument(0); records.put(r.getIdempotencyKey(), r); return 1; });
        when(mapper.insertItem(any())).thenAnswer(i -> { VersionReleaseItem item = i.getArgument(0); items.computeIfAbsent(item.getReleaseId(), k -> new ArrayList<VersionReleaseItem>()).add(item); return 1; });
        when(mapper.selectItemsForUpdate(eq("W"), anyString())).thenAnswer(i -> new ArrayList<VersionReleaseItem>(items.getOrDefault(i.getArgument(1), Collections.emptyList())));
        when(mapper.selectRecordForUpdate(eq("W"), anyString())).thenAnswer(i -> records.values().stream().filter(r -> r.getId().equals(i.getArgument(1))).findFirst().orElse(null));
        when(mapper.selectRecordsForUpdate("W", "V")).thenAnswer(i -> new ArrayList<VersionRelease>(records.values()));
        when(mapper.insertLog(anyString(), anyString(), anyString(), anyString(), any(), anyString())).thenReturn(1);
        when(tx.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    }
    @AfterEach void teardown() { TransactionSynchronizationManager.clear(); }

    @Test void subsetIsExplicitAndOmittedPlanTaskGetsImmutableSnapshot() {
        ReleaseConfirmRequest r = request(plan("production"), "one"); r.setActualTaskIds(Collections.singletonList("T1")); r.setDeviationReason("Only first batch deployed");
        VersionRelease saved = confirm(r);
        assertEquals(1, saved.getPublishedCount()); assertEquals(1, saved.getExcludedCount()); assertEquals(2, saved.getItems().size());
        assertEquals("published", saved.getItems().get(0).getDisposition()); assertEquals("not_selected", saved.getItems().get(1).getDisposition());
        assertEquals("Only first batch deployed", saved.getItems().get(1).getReason());
        scope.get(0).setTitle("renamed"); assertEquals("T1", saved.getItems().get(0).getTitle());
        assertNull(scope.get(0).getPublishedAt()); assertEquals("done", scope.get(0).getBoardColumn());
        assertEquals("E", saved.getExecutorUserId()); assertEquals("Executor", saved.getExecutorName()); assertEquals("U", saved.getReleasedBy());
        assertEquals(TIME.toLocalDateTime(), saved.getOccurredAt()); assertTrue(saved.getRecordedAt().isAfter(saved.getOccurredAt()));
        verifyNoInteractions(notifications); assertEquals(1, TransactionSynchronizationManager.getSynchronizations().size());
        TransactionSynchronizationManager.getSynchronizations().forEach(s -> s.afterCommit());
        verify(notifications).notifyLinked(anyString(), eq("W"), anyString(), anyString(), anyString(), anyString(), eq("V"), eq("P"));
        verify(versions, never()).update(any());
        verify(versions, never()).touchRevision(anyString(), anyString());
    }
    @ParameterizedTest @ValueSource(strings = {"", "Only first batch deployed"})
    void previewIncludesOmittedTaskDetailAndExplicitReason(String reason) {
        ReleaseConfirmRequest r = request(plan("production"), "omitted-detail");
        r.setActualTaskIds(Collections.singletonList("T1")); r.setDeviationReason(reason);
        ReleasePreviewResponse p = service.preview("U", "W", "V", r);
        assertEquals(1, p.getCandidates().size()); assertEquals(1, p.getExcluded().size());
        ReleasePreviewResponse.ExcludedTask excluded = p.getExcluded().get(0);
        assertSame(scope.get(1), excluded.getTask()); assertEquals("T2", excluded.getTask().getId());
        assertEquals(reason.isEmpty() ? "本次实际范围未选择" : reason, excluded.getReason());
        assertEquals(Collections.singletonList("V"), excluded.getTask().getVersionIds());
        assertEquals(Collections.singletonList("1.0"), excluded.getTask().getVersionNames());
    }
    @Test void previewLoadsTwoAlignedVersionsInOneLockedBatchWithoutReplacingTasks() {
        ReleaseConfirmRequest r = request(plan("test"), "two-versions");
        bindings.add(0, binding("T1", "V2", "2.0"));
        scope.get(0).setVersionIds(Collections.singletonList("stale"));
        scope.get(0).setVersionNames(Collections.singletonList("stale name"));
        clearInvocations(mapper);
        ReleasePreviewResponse p = service.preview("U", "W", "V", r);
        assertEquals(2, p.getCandidates().size()); assertSame(scope.get(0), p.getCandidates().get(0));
        assertEquals(Arrays.asList("V", "V2"), p.getCandidates().get(0).getVersionIds());
        assertEquals(Arrays.asList("1.0", "2.0"), p.getCandidates().get(0).getVersionNames());
        verify(mapper).selectTaskVersionRowsForUpdate("W", Arrays.asList("T1", "T2"));
        verify(mapper, never()).selectTaskForUpdate(anyString(), anyString());
        r.setScopeToken(p.getScopeToken()); r.setPlanRevision(p.getPlanRevision());
        assertEquals(2, service.confirm("U", "W", "V", r).getPublishedCount());
    }
    @ParameterizedTest @ValueSource(strings = {"selected", "omitted", "scope"})
    void versionMembershipAndNamesOfAllTokenTasksInvalidateConfirmation(String context) {
        ReleaseConfirmRequest r = request(plan("test"), "version-context");
        scope.add(task("T3")); bindings.add(binding("T3", "V", "1.0"));
        r.setActualTaskIds(Collections.singletonList("T1")); r.setDeviationReason("Subset delivery");
        preview(r);
        String id = "selected".equals(context) ? "T1" : "omitted".equals(context) ? "T2" : "T3";
        bindings.stream().filter(row -> id.equals(row.getTaskId())).findFirst().get().setVersionName("renamed");
        bindings.add(binding(id, "V2", "2.0"));
        code(409, () -> service.confirm("U", "W", "V", r));
        verify(mapper, never()).insertRecord(any());
    }
    @Test void scopedVersionHydrationBatchesAt500AndKeepsUnboundTasks() {
        ReleaseConfirmRequest r = request(plan("test"), "batched-versions");
        for (int i = 3; i <= 501; i++) scope.add(task(String.format("X%04d", i)));
        Task unbound = scope.get(2); unbound.setVersionIds(Collections.singletonList("stale"));
        unbound.setVersionNames(Collections.singletonList("stale name"));
        clearInvocations(mapper);
        ReleasePreviewResponse p = service.preview("U", "W", "V", r);
        assertEquals(2, p.getCandidates().size()); assertEquals(501, scope.size());
        assertSame(unbound, scope.get(2)); assertTrue(unbound.getVersionIds().isEmpty()); assertTrue(unbound.getVersionNames().isEmpty());
        org.mockito.ArgumentCaptor<List<String>> batches = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(mapper, times(2)).selectTaskVersionRowsForUpdate(eq("W"), batches.capture());
        assertEquals(500, batches.getAllValues().get(0).size()); assertEquals(1, batches.getAllValues().get(1).size());
        List<String> ids = new ArrayList<String>(batches.getAllValues().get(0)); ids.addAll(batches.getAllValues().get(1));
        assertEquals(new ArrayList<String>(new TreeSet<String>(ids)), ids);
    }
    @Test void failureThenRealRetrySamePlanCompletesOnlyOnSuccess() {
        VersionReleasePlan plan = plan("production"); ReleaseConfirmRequest failed = request(plan, "failure"); failed.setResult("failed"); failed.setFailureReason("build failed");
        VersionRelease first = confirm(failed); assertEquals("candidate", first.getItems().get(0).getDisposition()); assertEquals("ready", plan.getStatus());
        assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty());
        ReleaseConfirmRequest retry = request(plan, "retry"); retry.setRelatedReleaseId(first.getId()); retry.setDeviationReason("New external attempt after repair");
        VersionRelease second = confirm(retry); assertNotEquals(first.getId(), second.getId()); assertEquals("completed", plan.getStatus());
    }
    @Test void twoPlansTwoSuccessesAndReleasedVersionDoesNotBlockEvents() {
        VersionReleasePlan first = plan("test"); confirm(request(first, "test"));
        version.setStatus("released"); VersionReleasePlan second = plan("production"); confirm(request(second, "prod"));
        assertNotEquals(first.getId(), second.getId()); assertEquals(2, records.size()); assertEquals(1, TransactionSynchronizationManager.getSynchronizations().size());
    }
    @Test void sameKeyReplayBeforeCompletedPlanReadAndNoDuplicateNotification() {
        ReleaseConfirmRequest r = request(plan("production"), "key"); VersionRelease saved = confirm(r);
        clearInvocations(mapper); assertSame(saved, service.confirm("U", "W", "V", r));
        verify(mapper, never()).selectPlanForUpdate(anyString(), anyString()); verify(mapper, never()).insertRecord(any());
        assertEquals(1, TransactionSynchronizationManager.getSynchronizations().size()); r.setNotes("changed"); code(409, () -> service.confirm("U", "W", "V", r));
    }
    @Test void completedPlanCannotBeReusedOrEdited() {
        VersionReleasePlan plan = plan("production"); confirm(request(plan, "first")); code(409, () -> service.preview("U", "W", "V", request(plan, "new")));
        ReleasePlanRequest update = planRequest("production"); update.setId(plan.getId()); update.setRevision(plan.getRevision()); code(409, () -> service.savePlan("U", "W", "V", update));
    }
    @Test void incompleteFactualSuccessNeedsReasonButIsNotExcluded() {
        VersionReleasePlan plan = plan("production"); scope.get(0).setBoardColumn("doing"); ReleaseConfirmRequest r = request(plan, "incomplete");
        ReleasePreviewResponse p = service.preview("U", "W", "V", r); assertEquals(2, p.getCandidates().size()); assertTrue(p.getExcluded().isEmpty()); assertTrue(p.isRequiresDeviationReason());
        r.setScopeToken(p.getScopeToken()); r.setPlanRevision(p.getPlanRevision()); code(422, () -> service.confirm("U", "W", "V", r));
        r.setDeviationReason("Manager records anomalous real deployment");
        VersionRelease recorded = confirm(r);
        assertEquals(2, recorded.getPublishedCount());
        assertEquals("doing", recorded.getItems().get(0).getBoardColumn());
        assertEquals("doing", scope.get(0).getBoardColumn());
    }
    @ParameterizedTest @ValueSource(strings = {"task", "artifact", "time", "target", "executor", "plan"})
    void allConfirmationContextIsHashed(String change) {
        ReleaseConfirmRequest r = request(plan("production"), "context"); preview(r);
        if (change.equals("task")) scope.get(0).setTitle("changed"); if (change.equals("artifact")) r.setArtifactRef("build2");
        if (change.equals("time")) r.setOccurredAt(TIME.minusHours(1)); if (change.equals("target")) r.setTargetKeys(Collections.singletonList("other"));
        if (change.equals("executor")) r.setExecutorUserId("U"); if (change.equals("plan")) plans.get(r.getPlanId()).setRevision(1L);
        code(409, () -> service.confirm("U", "W", "V", r)); verify(mapper, never()).insertRecord(any());
    }
    @Test void duplicateMissingForeignAndEmptyActualTasksReject() {
        ReleaseConfirmRequest r = request(plan("production"), "invalid"); r.setActualTaskIds(Arrays.asList("T1", "T1")); code(400, () -> service.preview("U", "W", "V", r));
        r.setActualTaskIds(Collections.singletonList("missing")); code(400, () -> service.preview("U", "W", "V", r)); r.setActualTaskIds(Collections.emptyList()); preview(r); code(422, () -> service.confirm("U", "W", "V", r));
        r.setActualTaskIds(Collections.singletonList("T1")); scope.get(0).setReqId("foreign"); code(409, () -> service.preview("U", "W", "V", r));
    }
    @Test void emergencyAndRollbackUseSavedIdentityWithTargetSubset() {
        VersionRelease first = confirm(request(plan("production"), "first")); ReleaseConfirmRequest r = request(null, "rollback"); r.setOperation("rollback"); r.setRelatedReleaseId(first.getId());
        r.setTargetKeys(Collections.singletonList("a")); r.setActualTaskIds(Collections.singletonList("T1")); r.setDeviationReason("Rollback first target");
        scope.clear(); VersionRelease saved = confirm(r); assertEquals("rolled_back", saved.getItems().get(0).getDisposition()); assertEquals("T1", saved.getItems().get(0).getTitle()); assertEquals(0, saved.getPublishedCount());
        r.setTargetKeys(Collections.singletonList("outside")); code(400, () -> service.preview("U", "W", "V", r));
    }
    @Test void redeployRequiresMatchingSuccessfulVersionEnvironmentArtifactAndTargets() {
        VersionRelease original = confirm(request(plan("production"), "original")); ReleaseConfirmRequest r = request(null, "redeploy"); r.setOperation("redeploy"); r.setRelatedReleaseId(original.getId()); r.setDeviationReason("Reinstall same artifact");
        assertEquals("redeploy", confirm(r).getOperation()); r.setArtifactDigest(String.join("", Collections.nCopies(64, "b"))); code(400, () -> service.preview("U", "W", "V", r));
    }
    @Test void testRecordsDoNotNotifyAndReplayLookupIsReadOnly() {
        VersionRelease record = confirm(request(plan("test"), "test")); assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty());
        when(mapper.selectByKey("W", "V", "test")).thenReturn(record); when(mapper.selectItems("W", record.getId())).thenReturn(record.getItems());
        assertEquals(Collections.singletonList(record), service.records("U", "W", "V", "test")); verifyNoInteractions(notifications);
    }
    @Test void developerExecutorIsAcceptedWithoutProjectManagementPermission() {
        ReleaseConfirmRequest r = request(plan("production"), "developer-executor");
        when(members.selectDeliveryAccessForUpdate("W", "E", null)).thenReturn(Collections.singletonMap("role", "developer"));
        doThrow(new AppException(403, "executor is not a manager")).when(permissions).assertManageProjectForUpdate("E", "W", "P");
        clearInvocations(permissions);
        assertEquals("E", confirm(r).getExecutorUserId());
        verify(permissions, times(2)).assertManageProjectForUpdate("U", "W", "P");
        verify(permissions, never()).assertManageProjectForUpdate("E", "W", "P");
    }
    @ParameterizedTest @ValueSource(strings = {"departed", "roleless"})
    void executorCurrentMembershipIsRequiredInPreviewAndRecheckedOnConfirm(String state) {
        ReleaseConfirmRequest r = request(plan("production"), "executor-membership"); preview(r);
        when(members.selectDeliveryAccessForUpdate("W", "E", null)).thenReturn(
                "departed".equals(state) ? null : Collections.singletonMap("role", null));
        code(400, () -> service.confirm("U", "W", "V", r));
        code(400, () -> service.preview("U", "W", "V", r));
        verify(mapper, never()).insertRecord(any());
    }
    @ParameterizedTest @ValueSource(strings = {"missing", "disabled"})
    void executorIdentityMustExistAndBeEnabled(String state) {
        ReleaseConfirmRequest r = request(plan("test"), "executor-identity");
        if ("missing".equals(state)) when(users.selectById("E")).thenReturn(null);
        else users.selectById("E").setDisabled(true);
        code(400, () -> service.preview("U", "W", "V", r));
        verify(mapper, never()).insertRecord(any());
    }
    @Test void preciseTimeAndEmergencyReasonRequired() {
        ReleaseConfirmRequest r = request(null, "bad"); r.setDeviationReason(null); code(400, () -> service.preview("U", "W", "V", r));
        r.setDeviationReason("emergency"); r.setOccurredAt(null); code(400, () -> service.preview("U", "W", "V", r)); r.setOccurredAt(OffsetDateTime.now().plusDays(1)); code(400, () -> service.preview("U", "W", "V", r));
    }
    @Test void snapshotInsertFailureDoesNotScheduleAfterCommit() {
        ReleaseConfirmRequest r = request(plan("production"), "fault"); preview(r); doReturn(0).when(mapper).insertItem(any()); code(409, () -> service.confirm("U", "W", "V", r)); assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty());
    }
    @Test void twoIndependentProductionPlansCanEachHaveSuccess() {
        VersionReleasePlan first = plan("production");
        VersionRelease one = confirm(request(first, "production-one"));
        VersionReleasePlan second = plan("production");
        VersionRelease two = confirm(request(second, "production-two"));
        assertNotEquals(one.getId(), two.getId());
        assertNotEquals(one.getPlanId(), two.getPlanId());
        assertEquals(2, records.size());
    }

    @Test void sameProjectPlanVersionDeviationRequiresReasonAndKeepsBothIdentities() {
        VersionReleasePlan planned = plan("production");
        ProjectVersion actual = new ProjectVersion();
        actual.setId("V2"); actual.setWorkspaceId("W"); actual.setReqId("P"); actual.setName("2.0"); actual.setRevision(0L);
        when(versions.selectById("V2")).thenReturn(actual);
        when(versions.selectByIdForUpdate("W", "V2")).thenReturn(actual);
        when(mapper.selectScope("W", "V2")).thenReturn(Collections.emptyList());
        List<Task> plannedScope = Arrays.asList(task("T1"), task("T2"));
        when(mapper.selectScope("W", "V")).thenReturn(plannedScope);
        bindings.add(binding("T1", "V2", "2.0"));
        when(mapper.selectByKeyForUpdate(eq("W"), eq("V2"), anyString())).thenAnswer(i -> records.get(i.getArgument(2)));
        ReleaseConfirmRequest r = request(planned, "deviation");
        ReleasePreviewResponse preview = service.preview("U", "W", "V2", r);
        assertTrue(preview.isRequiresDeviationReason());
        assertEquals(2, preview.getCandidates().size());
        assertNotSame(plannedScope.get(0), preview.getCandidates().get(0));
        for (Task task : Arrays.asList(plannedScope.get(0), preview.getCandidates().get(0))) {
            assertEquals(Arrays.asList("V", "V2"), task.getVersionIds());
            assertEquals(Arrays.asList("1.0", "2.0"), task.getVersionNames());
        }
        r.setPlanRevision(preview.getPlanRevision()); r.setScopeToken(preview.getScopeToken());
        code(422, () -> service.confirm("U", "W", "V2", r));
        r.setResult("failed"); r.setFailureReason("External deployment failed");
        code(422, () -> service.confirm("U", "W", "V2", r));
        r.setResult("success");
        r.setDeviationReason("Actually delivered in another version of the same project");
        preview = service.preview("U", "W", "V2", r); r.setScopeToken(preview.getScopeToken());
        VersionRelease saved = service.confirm("U", "W", "V2", r);
        assertEquals("V2", saved.getVersionId()); assertEquals(planned.getId(), saved.getPlanId());
    }

    @Test void canceledPlanCanOnlyRecordAnomalousSuccessWithReason() {
        VersionReleasePlan canceled = plan("production"); canceled.setStatus("canceled");
        ReleaseConfirmRequest r = request(canceled, "canceled"); preview(r);
        code(422, () -> service.confirm("U", "W", "V", r));
        r.setDeviationReason("Deployment happened despite cancellation");
        assertEquals("success", confirm(r).getResult());
        assertEquals("completed", canceled.getStatus());
    }

    @Test void readyPlanUpdateRequiresExplicitIdentityRevisionAndReason() {
        VersionReleasePlan saved = plan("production");
        ReleasePlanRequest update = planRequest("production"); update.setId(saved.getId()); update.setRevision(saved.getRevision());
        code(400, () -> service.savePlan("U", "W", "V", update));
        update.setReason("Change scheduled batch"); update.setPlannedTaskIds(Collections.singletonList("T1"));
        VersionReleasePlan changed = service.savePlan("U", "W", "V", update);
        assertEquals(saved.getId(), changed.getId()); assertEquals(1L, changed.getRevision());
        assertEquals(Collections.singletonList("T1"), changed.getPlannedTaskIds());
        code(409, () -> service.savePlan("U", "W", "V", update));
    }

    @Test void preciseOffsetsNormalizeToUtcAndTaskLimitIsEnforced() {
        ReleaseConfirmRequest r = request(null, "offset");
        r.setOccurredAt(TIME.withOffsetSameInstant(ZoneOffset.ofHours(8)).plusNanos(123456789));
        VersionRelease saved = confirm(r);
        assertEquals(TIME.toLocalDateTime().plusNanos(123456000), saved.getOccurredAt());
        assertEquals(ZoneOffset.UTC, r.getOccurredAt().getOffset());
        r.setActualTaskIds(java.util.stream.IntStream.range(0, 501).mapToObj(i -> "T" + i).collect(java.util.stream.Collectors.toList()));
        code(400, () -> service.preview("U", "W", "V", r));
    }

    @Test void replayDoesNotRequireExecutorToRemainAvailableAndLocksMembersInStableOrder() {
        ReleaseConfirmRequest r = request(plan("production"), "replay-executor");
        VersionRelease saved = confirm(r);
        when(members.selectDeliveryAccessForUpdate("W", "E", null)).thenReturn(null);
        when(users.selectById("E")).thenReturn(null);
        clearInvocations(members, permissions);
        assertSame(saved, service.confirm("U", "W", "V", r));
        org.mockito.InOrder order = inOrder(members);
        order.verify(members).selectDeliveryAccessForUpdate("W", "E", null);
        order.verify(members).selectDeliveryAccessForUpdate("W", "U", null);
        verify(permissions, never()).assertManageProjectForUpdate("E", "W", "P");
    }

    @Test void auditInsertFailureDoesNotScheduleAfterCommit() {
        ReleaseConfirmRequest r = request(plan("production"), "audit-fault"); preview(r);
        when(mapper.insertLog(anyString(), anyString(), anyString(), anyString(), any(), anyString())).thenReturn(0);
        code(409, () -> service.confirm("U", "W", "V", r));
        assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty());
    }

    @Test void mapperUsesCurrentUncachedVersionBatchAndOrdersRecordsByOccurrence() throws Exception {
        org.apache.ibatis.session.Configuration configuration = new org.apache.ibatis.session.Configuration();
        configuration.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        try (java.io.InputStream xml = getClass().getClassLoader().getResourceAsStream("mapper/ReleaseMapper.xml")) {
            assertNotNull(xml);
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(xml, configuration, "mapper/ReleaseMapper.xml", configuration.getSqlFragments()).parse();
        }
        String namespace = "com.hourglass.mapper.ReleaseMapper.";
        Map<String, Object> params = new HashMap<String, Object>(); params.put("workspaceId", "W");
        params.put("versionId", "V"); params.put("taskIds", Arrays.asList("T1", "T2"));
        org.apache.ibatis.mapping.MappedStatement batch = configuration.getMappedStatement(namespace + "selectTaskVersionRowsForUpdate");
        assertFalse(batch.isUseCache()); assertTrue(batch.isFlushCacheRequired());
        String bindingSql = batch.getBoundSql(params).getSql().replaceAll("\\s+", " ").trim();
        assertTrue(bindingSql.contains("pv.workspace_id = vt.workspace_id")); assertTrue(bindingSql.contains("pv.req_id = t.req_id"));
        assertTrue(bindingSql.endsWith("ORDER BY vt.task_id, vt.version_id FOR UPDATE"));
        String scopeSql = configuration.getMappedStatement(namespace + "selectScope").getBoundSql(params).getSql();
        assertFalse(scopeSql.contains("blocked, vt.version_id")); assertFalse(scopeSql.contains("AS version_name"));
        String recordsSql = configuration.getMappedStatement(namespace + "selectRecords").getBoundSql(params).getSql().replaceAll("\\s+", " ").trim();
        assertTrue(recordsSql.endsWith("ORDER BY occurred_at DESC, recorded_at DESC, id DESC"));
    }

    @Test void scheduleDefaultsToOpenPlansAndKeepsProjectVisibilityScope() {
        when(access.viewerScope("W", "U")).thenReturn("U");
        when(mapper.selectPlanSchedule("W", LocalDate.parse("2026-11-01"), LocalDate.parse("2026-12-31"), "P",
                "production", Arrays.asList("draft", "ready"), "U", 500))
                .thenReturn(Collections.<ReleasePlanRow>emptyList());
        assertTrue(service.planSchedule("U", "W", "2026-11-01", "2026-12-31", "P", "production", "open").isEmpty());
        verify(access).assertView("W", "U", "P");
    }

    @Test void scheduleAcceptsAllStatusesAndRejectsInvalidFilters() {
        when(access.viewerScope("W", "U")).thenReturn(null);
        when(mapper.selectPlanSchedule("W", null, null, null, null, null, null, 500))
                .thenReturn(Collections.<ReleasePlanRow>emptyList());
        assertTrue(service.planSchedule("U", "W", null, null, null, null, "all").isEmpty());
        code(400, () -> service.planSchedule("U", "W", "2026-13-01", null, null, null, null));
        code(400, () -> service.planSchedule("U", "W", "2026-12-31", "2026-11-01", null, null, null));
        code(400, () -> service.planSchedule("U", "W", null, null, null, "prod", null));
        code(400, () -> service.planSchedule("U", "W", null, null, null, null, "done"));
    }

    private VersionRelease confirm(ReleaseConfirmRequest r) { preview(r); return service.confirm("U", "W", "V", r); }
    private void preview(ReleaseConfirmRequest r) { ReleasePreviewResponse p = service.preview("U", "W", "V", r); r.setPlanRevision(p.getPlanRevision()); r.setScopeToken(p.getScopeToken()); }
    private VersionReleasePlan plan(String env) { return service.savePlan("U", "W", "V", planRequest(env)); }
    private ReleasePlanRequest planRequest(String env) {
        ReleasePlanRequest r = new ReleasePlanRequest(); r.setStatus("ready"); r.setOwnerUserId("U"); r.setPlannedAt(LocalDateTime.now().plusDays(1));
        r.setPlannedTaskIds(Arrays.asList("T1", "T2")); r.setEnvironment(env); r.setTargetKeys(Arrays.asList("a", "b")); r.setCoverage("full"); return r;
    }
    private ReleaseConfirmRequest request(VersionReleasePlan p, String key) {
        ReleaseConfirmRequest r = new ReleaseConfirmRequest(); r.setPlanId(p == null ? null : p.getId()); r.setOccurredAt(TIME); r.setEnvironment(p == null ? "production" : p.getEnvironment());
        r.setTargetKeys(Arrays.asList("a", "b")); r.setCoverage("full"); r.setArtifactRef("build1"); r.setArtifactDigest(DIGEST); r.setOperation("deploy");
        r.setActualTaskIds(Arrays.asList("T1", "T2")); r.setExecutorUserId("E"); r.setResult("success"); r.setIdempotencyKey(key); if (p == null) r.setDeviationReason("Emergency actual event"); return r;
    }
    private TaskVersionBinding binding(String taskId, String versionId, String versionName) {
        TaskVersionBinding row = new TaskVersionBinding(); row.setTaskId(taskId); row.setVersionId(versionId); row.setVersionName(versionName); return row;
    }
    private Task task(String id) {
        Task t = new Task(); t.setId(id); t.setTitle(id); t.setItemType("task"); t.setWorkspaceId("W"); t.setReqId("P"); t.setOwnerUserId("O"); t.setBoardColumn("done"); t.setCompletedAt(TIME.toLocalDate()); return t;
    }
    private void code(int expected, org.junit.jupiter.api.function.Executable action) { assertEquals(expected, assertThrows(AppException.class, action).getCode()); }
}
