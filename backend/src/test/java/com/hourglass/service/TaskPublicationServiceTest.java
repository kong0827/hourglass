package com.hourglass.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.entity.*;
import com.hourglass.mapper.*;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TaskPublicationServiceTest {
    private final ReleaseMapper mapper = mock(ReleaseMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final TaskPublicationService service = new TaskPublicationService(tasks, mapper,
            mock(TaskLogMapper.class), mock(DeliveryScopeLock.class), permissions, new ObjectMapper());

    @Test void failedTestAndStagingCannotGrantProductionBadge() {
        VersionRelease failed = event("failed", 1, "a"); failed.setResult("failed");
        VersionRelease test = event("test", 2, "a"); test.setEnvironment("test");
        VersionRelease staging = event("staging", 3, "a"); staging.setEnvironment("staging");
        TaskPublicationService.PublicationSummary s = service.project("T", Arrays.asList(failed, test, staging));
        assertFalse(s.isEverPublished()); assertEquals("unpublished", s.getPublicationState()); assertNull(s.getPublishedAt());
    }
    @Test void plannedButNotActualIsNeverEvidence() {
        VersionRelease record = event("one", 1, "a"); record.getItems().get(0).setDisposition("not_selected");
        assertFalse(service.project("T", Collections.singletonList(record)).isEverPublished());
    }
    @Test void failureDoesNotEraseEarlierProductionSuccess() {
        VersionRelease success = event("one", 1, "a"); VersionRelease failed = event("two", 2, "a"); failed.setResult("failed");
        assertSame(success, service.project("T", Arrays.asList(failed, success)).getLatestEffectiveRecord());
    }
    @Test void partialRollbackPreservesOtherTargetsAndHistory() {
        VersionRelease original = event("one", 1, "a", "b"); VersionRelease rollback = rollback("rollback", 2, "one", "a");
        TaskPublicationService.PublicationSummary s = service.project("T", Arrays.asList(rollback, original));
        assertTrue(s.isEverPublished()); assertEquals("partial", s.getPublicationState()); assertEquals(Collections.singletonList("b"), s.getPublicationTargets());
        assertEquals("published", original.getItems().get(0).getDisposition());
        rollback.setTargetKeys(Arrays.asList("a", "b")); s = service.project("T", Arrays.asList(original, rollback));
        assertEquals("rolled_back", s.getPublicationState()); assertTrue(s.isEverPublished()); assertNull(s.getPublishedAt());
    }
    @Test void rollbackCannotCancelLaterUnrelatedSuccessAndOccurrenceBeatsLateRecording() {
        VersionRelease original = event("one", 1, "a"); original.setRecordedAt(LocalDateTime.of(2026, 11, 9, 12, 0));
        VersionRelease later = event("two", 3, "a"); later.setOperation("redeploy");
        VersionRelease rollback = rollback("rollback", 4, "one", "a");
        TaskPublicationService.PublicationSummary s = service.project("T", Arrays.asList(rollback, original, later));
        assertSame(later, s.getLatestEffectiveRecord()); assertEquals("effective", s.getPublicationState());
    }
    @Test void sameOccurrenceUsesRecordingThenIdDeterministically() {
        VersionRelease first = event("a", 1, "a"); VersionRelease last = event("b", 1, "a");
        assertSame(last, service.project("T", Arrays.asList(last, first)).getLatestEffectiveRecord());
        first.setRecordedAt(last.getRecordedAt().plusHours(1)); assertSame(first, service.project("T", Arrays.asList(last, first)).getLatestEffectiveRecord());
    }
    @Test void unknownIsNotFullAndKnownLaterTargetCanResolveIt() {
        VersionRelease unknown = event("one", 1, "a"); unknown.setCoverage("unknown");
        assertEquals("unknown", service.project("T", Collections.singletonList(unknown)).getPublicationState());
        VersionRelease known = event("two", 2, "a"); assertEquals("effective", service.project("T", Arrays.asList(unknown, known)).getPublicationState());
        known.setCoverage("partial"); assertEquals("partial", service.project("T", Arrays.asList(unknown, known)).getPublicationState());
    }
    @Test void enrichIgnoresStoredManualFieldsAndIsAlwaysReadonly() {
        Task task = new Task(); task.setId("T"); task.setWorkspaceId("W"); task.setPublishedAt(LocalDate.now()); task.setPublishSource("manual");
        VersionRelease success = event("one", 1, "a"); when(mapper.selectPublicationRecords("W", Collections.singletonList("T"))).thenReturn(Collections.singletonList(success));
        service.enrichTasks("W", Collections.singletonList(task)); assertEquals("record", task.getPublishSource()); assertEquals("one", task.getPublishedReleaseId());
        assertFalse(task.getCanPublish()); assertFalse(task.getCanUnpublish()); assertTrue(task.getEverPublished());
        assertEquals(success.getOccurredAt().toLocalDate(), task.getPublishedAt());
        when(mapper.selectPublicationRecords("W", Collections.singletonList("T"))).thenReturn(Collections.emptyList());
        service.enrichTasks("W", Collections.singletonList(task)); assertNull(task.getPublishedAt()); assertNull(task.getPublishSource()); assertFalse(task.getEverPublished());
    }
    @Test void manualHttpWritesAndMapperMutationsAreAbsent() {
        for (java.lang.reflect.Method method : com.hourglass.controller.TaskPublicationController.class.getDeclaredMethods())
            assertNull(method.getAnnotation(org.springframework.web.bind.annotation.PostMapping.class));
        for (java.lang.reflect.Method method : ReleaseMapper.class.getMethods()) assertFalse(Arrays.asList("publishTask", "unpublishTask").contains(method.getName()));
    }
    @Test void deletedTaskHistoryIncludesFailureTestAndRollbackWithProjectVisibility() {
        Task task = new Task(); task.setId("T"); task.setWorkspaceId("W"); task.setReqId("P"); task.setDeletedAt(LocalDateTime.now());
        when(tasks.selectById("T")).thenReturn(task);
        VersionRelease failed = event("failed", 1, "a"); failed.setResult("failed");
        VersionRelease test = event("test", 2, "a"); test.setEnvironment("test");
        VersionRelease rollback = rollback("rollback", 3, "prior", "a");
        VersionRelease hidden = event("hidden", 4, "a"); hidden.setReqId("hidden-project");
        when(mapper.selectTaskRecords("W", "T")).thenReturn(Arrays.asList(failed, test, rollback, hidden));
        when(permissions.canViewProject("U", "W", "P")).thenReturn(true);
        for (VersionRelease record : Arrays.asList(failed, test, rollback))
            when(mapper.selectItems("W", record.getId())).thenReturn(record.getItems());
        assertEquals(Arrays.asList(failed, test, rollback), service.records("U", "W", "T"));
        verify(permissions).assertViewTask("U", "W", task);
        verify(mapper, never()).selectItems("W", "hidden");
    }

    @Test void physicallyRemovedTaskUsesVisibleImmutableHistoryAndHidesInvisibleIdentity() {
        VersionRelease saved = event("saved", 1, "a");
        when(mapper.selectTaskRecords("W", "T")).thenReturn(Collections.singletonList(saved));
        when(mapper.selectItems("W", "saved")).thenReturn(saved.getItems());
        when(permissions.canViewProject("U", "W", "P")).thenReturn(true);
        assertEquals(Collections.singletonList(saved), service.records("U", "W", "T"));
        when(permissions.canViewProject("U", "W", "P")).thenReturn(false);
        assertEquals(404, assertThrows(com.hourglass.common.AppException.class, () -> service.records("U", "W", "T")).getCode());
    }

    @Test void mapperParsesListsDemandImmutableItemsAndCurrentReads() throws Exception {
        org.apache.ibatis.session.Configuration cfg = new org.apache.ibatis.session.Configuration(); cfg.setMapUnderscoreToCamelCase(true);
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity"); String resource = "mapper/ReleaseMapper.xml";
        try (java.io.InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(input, cfg, resource, cfg.getSqlFragments()).parse();
        }
        Map<String, Object> params = new HashMap<String, Object>(); params.put("workspaceId", "W"); params.put("planId", "RP"); params.put("taskIds", Collections.singletonList("T"));
        for (String name : Arrays.asList("selectPlanForUpdate", "selectPlannedTaskIdsForUpdate", "selectRecordForUpdate", "selectScope")) {
            org.apache.ibatis.mapping.MappedStatement statement = cfg.getMappedStatement("com.hourglass.mapper.ReleaseMapper." + name);
            assertFalse(statement.isUseCache()); assertTrue(statement.isFlushCacheRequired()); assertTrue(statement.getBoundSql(params).getSql().trim().endsWith("FOR UPDATE"));
        }
        String sql = cfg.getMappedStatement("com.hourglass.mapper.ReleaseMapper.selectTaskRecords").getBoundSql(params).getSql();
        assertFalse(sql.contains("result =")); assertFalse(sql.contains("disposition ="));
        for (String name : Arrays.asList("selectActiveTasksByProjectForUpdate", "selectAllTasksByProjectForUpdate"))
            assertFalse(cfg.getMappedStatement("com.hourglass.mapper.ReleaseMapper." + name).getBoundSql(params).getSql().contains("JOIN version_task"));
        assertTrue(cfg.getMappedStatement("com.hourglass.mapper.ReleaseMapper.selectDemandRecords").getResultMaps().get(0).getResultMappings().stream().anyMatch(m -> "items".equals(m.getProperty())));
    }
    private VersionRelease event(String id, int hour, String... targets) {
        VersionRelease r = new VersionRelease(); r.setId(id); r.setWorkspaceId("W"); r.setReqId("P"); r.setResult("success"); r.setOperation("deploy"); r.setEnvironment("production");
        r.setOccurredAt(LocalDateTime.of(2026, 11, 1, hour, 0)); r.setRecordedAt(r.getOccurredAt()); r.setTargetKeys(Arrays.asList(targets)); r.setCoverage("full");
        VersionReleaseItem item = new VersionReleaseItem(); item.setTaskId("T"); item.setDisposition("published"); r.setItems(Collections.singletonList(item)); return r;
    }
    private VersionRelease rollback(String id, int hour, String reference, String... targets) {
        VersionRelease r = event(id, hour, targets); r.setOperation("rollback"); r.setRelatedReleaseId(reference); r.getItems().get(0).setDisposition("rolled_back"); return r;
    }
}
