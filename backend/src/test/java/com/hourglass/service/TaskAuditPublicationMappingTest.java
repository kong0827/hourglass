package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskLogMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class TaskAuditPublicationMappingTest {
    @Test
    void structuredAuditPreservesLongReasonsIdsNamesAndNulls() throws Exception {
        TaskLogMapper mapper = mock(TaskLogMapper.class);
        ObjectMapper json = new ObjectMapper().findAndRegisterModules();
        TaskAuditLogger audit = new TaskAuditLogger(mapper, mock(RequirementMapper.class),
                mock(WorkspaceMetaCache.class), json);
        String reason = String.join("", Collections.nCopies(1000, "顺延原因"));
        Map<String, Object> after = new HashMap<String, Object>();
        after.put("versionIds", Collections.singletonList("V2"));
        after.put("versionNames", Collections.singletonList("第二版"));
        after.put("inheritanceSource", "demand");
        audit.logChange("U1", "W1", "K1", "version_change", "版本改变", null, after, reason);
        ArgumentCaptor<TaskLog> saved = ArgumentCaptor.forClass(TaskLog.class);
        verify(mapper).insert(saved.capture());
        JsonNode data = json.readTree(saved.getValue().getChangeData());
        assertTrue(data.get("before").isNull());
        assertEquals(reason, data.get("reason").asText());
        assertEquals("V2", data.path("after").path("versionIds").get(0).asText());
        assertEquals("第二版", data.path("after").path("versionNames").get(0).asText());
    }

    @Test
    void serializationFailureDoesNotSilentlyWritePartialAudit() throws Exception {
        TaskLogMapper mapper = mock(TaskLogMapper.class);
        ObjectMapper json = mock(ObjectMapper.class);
        when(json.writeValueAsString(any())).thenThrow(new com.fasterxml.jackson.core.JsonProcessingException("bad") { });
        TaskAuditLogger audit = new TaskAuditLogger(mapper, mock(RequirementMapper.class), mock(WorkspaceMetaCache.class), json);
        assertThrows(IllegalStateException.class, () -> audit.logChange("U1", "W1", "K1", "version_change",
                "变更", null, null, "原因"));
        verifyNoInteractions(mapper);
    }

    @Test
    void legacyLogStillWorksWithoutStructuredData() {
        TaskLogMapper mapper = mock(TaskLogMapper.class);
        TaskAuditLogger audit = new TaskAuditLogger(mapper, mock(RequirementMapper.class),
                mock(WorkspaceMetaCache.class), new ObjectMapper());
        audit.log("U1", "W1", "K1", "move", "移动", "done", "doing");
        ArgumentCaptor<TaskLog> saved = ArgumentCaptor.forClass(TaskLog.class);
        verify(mapper).insert(saved.capture());
        assertNull(saved.getValue().getChangeData());
        assertEquals("done", saved.getValue().getFromColumn());
    }

    private Configuration configuration() throws Exception {
        Configuration cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        for (String file : new String[]{"mapper/TaskMapper.xml", "mapper/TaskLogMapper.xml"}) {
            try (InputStream input = getClass().getClassLoader().getResourceAsStream(file)) {
                assertNotNull(input);
                new XMLMapperBuilder(input, cfg, file, cfg.getSqlFragments()).parse();
            }
        }
        return cfg;
    }

    @Test
    void ordinaryUpdateAndInsertsCannotOverwritePublicationFields() throws Exception {
        Configuration cfg = configuration();
        for (String statement : new String[]{"update", "insert", "insertBatch"}) {
            Object parameter = "insertBatch".equals(statement)
                    ? Collections.singletonMap("list", Collections.singletonList(new Task())) : new Task();
            String sql = cfg.getMappedStatement("com.hourglass.mapper.TaskMapper." + statement)
                    .getBoundSql(parameter).getSql();
            assertFalse(sql.contains("published_at"), statement);
            assertFalse(sql.contains("publish_source"), statement);
            assertFalse(sql.contains("published_release_id"), statement);
        }
    }

    @Test
    void taskSelectsExcludeManualPublicationFieldsAndAuditRetainsChangeData() throws Exception {
        Configuration cfg = configuration();
        for (String statement : new String[]{"selectById", "selectAll", "selectDeleted", "selectEstimateTasks", "selectMyTasks", "selectTasksForScope"}) {
            Map<String, Object> params = new HashMap<String, Object>();
            params.put("viewerId", null);
            String sql = cfg.getMappedStatement("com.hourglass.mapper.TaskMapper." + statement).getBoundSql(params).getSql();
            assertFalse(sql.contains("published_at"), statement + "：任务行不再提供人工徽标事实");
            assertFalse(sql.contains("publish_source"), statement);
            assertFalse(sql.contains("published_release_id"), statement);
        }
        String insert = cfg.getMappedStatement("com.hourglass.mapper.TaskLogMapper.insert")
                .getBoundSql(new TaskLog()).getSql();
        assertTrue(insert.contains("change_data"));
        String select = cfg.getMappedStatement("com.hourglass.mapper.TaskLogMapper.selectByTaskId")
                .getBoundSql(Collections.emptyMap()).getSql();
        assertTrue(select.contains("change_data"));
    }

    @Test
    void scopeReadsUseCurrentReadRatherThanConsistentSnapshots() throws Exception {
        Configuration cfg = configuration();
        for (String statement : new String[]{"selectTasksForScope", "selectDemandForScope", "selectVersionForScope",
                "selectTaskVersionsForScope", "selectTaskRecordIdsForScope", "selectVersionSuccessIdsForScope", "selectSuccessfulReleaseIdsForScope"}) {
            String sql = cfg.getMappedStatement("com.hourglass.mapper.TaskMapper." + statement)
                    .getBoundSql(Collections.emptyMap()).getSql();
            assertTrue(sql.contains("FOR UPDATE"), statement);
            assertTrue(sql.contains("workspace_id = ?"), statement);
        }
    }

    @Test
    void taskJsonExposesOnlyAlignedVersionArraysAndRequestDistinguishesNullFromEmpty() throws Exception {
        ObjectMapper json = new ObjectMapper().findAndRegisterModules();
        Task task = new Task();
        task.setVersionIds(java.util.Arrays.asList("V1", "V2"));
        task.setVersionNames(java.util.Arrays.asList("首版", "第二版"));
        JsonNode result = json.valueToTree(task);
        assertTrue(result.get("versionIds").isArray());
        assertTrue(result.get("versionNames").isArray());
        assertEquals("V2", result.get("versionIds").get(1).asText());
        assertEquals("第二版", result.get("versionNames").get(1).asText());
        assertFalse(result.has("versionId"));
        assertFalse(result.has("versionName"));
        assertNull(json.readValue("{}", TaskSaveRequest.class).getVersionIds());
        assertNull(json.readValue("{\"versionIds\":null}", TaskSaveRequest.class).getVersionIds());
        assertEquals(Collections.emptyList(), json.readValue("{\"versionIds\":[]}", TaskSaveRequest.class).getVersionIds());
        for (Class<?> type : new Class<?>[]{Task.class, TaskSaveRequest.class}) {
            assertThrows(NoSuchFieldException.class, () -> type.getDeclaredField("versionId"));
            assertThrows(NoSuchFieldException.class, () -> type.getDeclaredField("versionName"));
        }
    }

    @Test
    void demandTestPlanAndReleaseKeepTheirSingleVersionTarget() {
        ObjectMapper json = new ObjectMapper().findAndRegisterModules();
        com.hourglass.entity.Demand demand = new com.hourglass.entity.Demand();
        com.hourglass.entity.TestPlan plan = new com.hourglass.entity.TestPlan();
        com.hourglass.entity.VersionRelease release = new com.hourglass.entity.VersionRelease();
        demand.setVersionId("V1"); plan.setVersionId("V1"); release.setVersionId("V1");
        for (Object entity : new Object[]{demand, plan, release}) {
            JsonNode result = json.valueToTree(entity);
            assertEquals("V1", result.get("versionId").asText());
            assertFalse(result.has("versionIds"));
        }
    }

    @Test
    void clientSaveRequestDoesNotExposePublicationSetters() {
        for (String field : new String[]{"publishedAt", "publishSource", "publishedReleaseId"}) {
            assertThrows(NoSuchFieldException.class, () -> TaskSaveRequest.class.getDeclaredField(field));
        }
    }
}
