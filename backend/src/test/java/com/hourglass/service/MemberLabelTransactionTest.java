package com.hourglass.service;

import com.hourglass.dto.MemberLabelOptions;
import com.hourglass.entity.*;
import com.hourglass.mapper.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Spring 事务代理 + 可回滚内存 mapper：验证写中途及日志异常不会留下成功半批。 */
class MemberLabelTransactionTest {
    private final Map<String, ProjectMemberRole> rows = new LinkedHashMap<String, ProjectMemberRole>();
    private final List<String> dictionary = new ArrayList<String>();
    private final List<TaskLog> activities = new ArrayList<TaskLog>();
    private final List<AuditLog> audits = new ArrayList<AuditLog>();
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectMemberRoleMapper roles = mock(ProjectMemberRoleMapper.class);
    private final RequirementMapper projects = mock(RequirementMapper.class);
    private final WorkspaceMemberLabelOptionMapper options = mock(WorkspaceMemberLabelOptionMapper.class);
    private final TaskLogMapper activityMapper = mock(TaskLogMapper.class);
    private final AuditLogMapper auditMapper = mock(AuditLogMapper.class);
    private ProjectMemberRoleService roleService;
    private WorkspaceService workspaceService;
    private Requirement project;

    @BeforeEach
    void setup() {
        MemberLabelLogService logs = new MemberLabelLogService(activityMapper, auditMapper);
        ProjectAccessService access = mock(ProjectAccessService.class);
        when(access.roleOf("W1", "owner")).thenReturn("owner");
        when(access.canView(eq("W1"), anyString(), anyString())).thenReturn(true);
        List<WorkspaceMember> roster = new ArrayList<WorkspaceMember>();
        for (String id : Arrays.asList("U1", "U2")) {
            WorkspaceMember member = new WorkspaceMember(); member.setUserId(id); member.setRole("member");
            member.setJobTitle("开发");
            when(members.selectMember("W1", id)).thenReturn(member);
            roster.add(member);
        }
        when(members.selectByWorkspace("W1")).thenReturn(roster);
        Requirement source = new Requirement(); source.setId("P2"); source.setWorkspaceId("W1"); source.setName("源项目");
        when(projects.selectById("P2")).thenReturn(source);
        when(roles.selectByProject("W1", "P1")).thenAnswer(call -> new ArrayList<ProjectMemberRole>(rows.values()));
        when(roles.upsert(any())).thenAnswer(call -> {
            ProjectMemberRole row = call.getArgument(0); rows.put(row.getUserId(), row); return 1;
        });
        when(options.deleteAllByWorkspace("W1")).thenAnswer(call -> { dictionary.clear(); return 1; });
        when(options.insert(eq("W1"), anyString(), anyString(), anyInt())).thenAnswer(call -> {
            dictionary.add(call.getArgument(1) + ":" + call.getArgument(2)); return 1;
        });
        when(activityMapper.insert(any())).thenAnswer(call -> { activities.add(call.getArgument(0)); return 1; });
        when(auditMapper.insert(any())).thenAnswer(call -> { audits.add(call.getArgument(0)); return 1; });
        roleService = transactional(new ProjectMemberRoleService(members, mock(ProjectMemberMapper.class), roles,
                access, projects, options, logs));
        WorkspaceMemberCache cache = mock(WorkspaceMemberCache.class);
        Workspace ws = new Workspace(); ws.setMyRole("owner"); ws.setId("W1");
        when(cache.view("W1", "owner")).thenReturn(ws);
        workspaceService = transactional(new WorkspaceService(mock(WorkspaceMapper.class), members, mock(UserMapper.class),
                mock(BoardColumnMapper.class), mock(ColumnTransitionMapper.class), mock(CategoryMapper.class),
                mock(WorkspacePriorityMapper.class), mock(SavedViewMapper.class), mock(AppNotificationMapper.class),
                mock(UserListPreferenceMapper.class), mock(WorkActivityService.class), mock(InviteMapper.class),
                mock(InviteProjectGrantMapper.class), mock(ProjectMemberMapper.class), roles, mock(TaskWatchMapper.class),
                mock(TaskCascade.class), mock(ActivityService.class), cache, mock(WorkspaceMetaCache.class), options, logs,
                access));
        project = new Requirement(); project.setId("P1"); project.setWorkspaceId("W1"); project.setName("项目");
    }

    @Test
    void batchWriteFailureRollsBackEarlierMember() {
        doThrow(new IllegalStateException("write failed")).when(roles)
                .upsert(argThat(row -> row != null && "U2".equals(row.getUserId())));
        assertThrows(IllegalStateException.class, () -> saveBatch());
        assertTrue(rows.isEmpty());
        assertTrue(activities.isEmpty());
        assertTrue(audits.isEmpty());
    }

    @Test
    void auditFailureRollsBackBatchAndActivity() {
        doThrow(new IllegalStateException("audit failed")).when(auditMapper).insert(any());
        assertThrows(IllegalStateException.class, () -> saveBatch());
        assertTrue(rows.isEmpty());
        assertTrue(activities.isEmpty());
        assertTrue(audits.isEmpty());
    }

    @Test
    void activityFailureDoesNotReturnSuccessOrCommitBatch() {
        doReturn(0).when(activityMapper).insert(any());
        assertThrows(IllegalStateException.class, () -> saveBatch());
        assertTrue(rows.isEmpty());
        assertTrue(audits.isEmpty());
    }

    @Test
    void successfulBatchCommitsBothLogsWithActionAndActor() {
        assertEquals(Integer.valueOf(2), saveBatch().get("updated"));
        assertEquals(2, rows.size());
        assertEquals(1, activities.size());
        assertEquals("CFG", activities.get(0).getTaskId());
        assertEquals("owner", activities.get(0).getActorId());
        assertEquals(1, audits.size());
        assertEquals("project_role", audits.get(0).getAction());
        assertEquals("W1", audits.get(0).getWorkspaceId());
        assertEquals("success", audits.get(0).getResult());
    }

    @Test
    void dictionaryInsertFailureRestoresEntireOldDictionary() {
        dictionary.add("role:旧职能"); dictionary.add("company:旧公司");
        doThrow(new IllegalStateException("insert failed")).when(options).insert("W1", "company", "新公司", 0);
        assertThrows(IllegalStateException.class, () -> workspaceService.updateMemberLabelOptions("owner", "W1", request()));
        assertEquals(Arrays.asList("role:旧职能", "company:旧公司"), dictionary);
        assertTrue(audits.isEmpty());
    }

    @Test
    void dictionaryAuditFailureRestoresOldDictionaryAndActivity() {
        dictionary.add("role:旧职能");
        doReturn(0).when(auditMapper).insert(any());
        assertThrows(IllegalStateException.class, () -> workspaceService.updateMemberLabelOptions("owner", "W1", request()));
        assertEquals(Collections.singletonList("role:旧职能"), dictionary);
        assertTrue(activities.isEmpty());
    }

    @Test
    void dictionarySuccessCommitsActivityAndMemberLabelOptionsAudit() {
        workspaceService.updateMemberLabelOptions("owner", "W1", request());
        assertEquals(Arrays.asList("role:新职能", "company:新公司"), dictionary);
        assertEquals(1, activities.size());
        assertEquals("member_label_options", audits.get(0).getAction());
    }

    @Test
    void copyAuditFailureRollsBackAllSnapshotsAndActivity() {
        doThrow(new IllegalStateException("audit failed")).when(auditMapper).insert(any());
        assertThrows(IllegalStateException.class, () -> roleService.copyRoles("W1", project, "P2", false, "owner"));
        assertTrue(rows.isEmpty());
        assertTrue(activities.isEmpty());
    }

    @Test
    void successfulCopyCommitsSnapshotActivityAndAudit() {
        assertEquals(Integer.valueOf(2), roleService.copyRoles("W1", project, "P2", false, "owner").get("copied"));
        assertEquals(2, rows.size());
        assertEquals(1, activities.size());
        assertEquals("project_role", audits.get(0).getAction());
        assertTrue(audits.get(0).getDetail().contains("复制"));
    }

    @Test
    void jobTitleUsesRequiredAuditActionAndActivity() {
        workspaceService.updateMemberJobTitle("owner", "W1", "U1", "产品经理");
        verify(members).updateJobTitle("W1", "U1", "产品经理");
        assertEquals(1, activities.size());
        assertEquals("member_job_title", audits.get(0).getAction());
    }

    private Map<String, Integer> saveBatch() {
        return roleService.saveRoles("W1", project, Arrays.asList("U1", "U2"), "开发", Collections.emptyList(), "owner");
    }

    private MemberLabelOptions request() {
        MemberLabelOptions req = new MemberLabelOptions(); req.setRoleTitles(Collections.singletonList("新职能"));
        req.setCompanyNames(Collections.singletonList("新公司")); return req;
    }

    @SuppressWarnings("unchecked")
    private <T> T transactional(T target) {
        AbstractPlatformTransactionManager transactions = new AbstractPlatformTransactionManager() {
            private Map<String, ProjectMemberRole> oldRows;
            private List<String> oldDictionary;
            private List<TaskLog> oldActivities;
            private List<AuditLog> oldAudits;
            @Override protected Object doGetTransaction() { return new Object(); }
            @Override protected void doBegin(Object tx, TransactionDefinition definition) {
                oldRows = new LinkedHashMap<String, ProjectMemberRole>(rows);
                oldDictionary = new ArrayList<String>(dictionary);
                oldActivities = new ArrayList<TaskLog>(activities);
                oldAudits = new ArrayList<AuditLog>(audits);
            }
            @Override protected void doCommit(DefaultTransactionStatus status) { }
            @Override protected void doRollback(DefaultTransactionStatus status) {
                rows.clear(); rows.putAll(oldRows);
                dictionary.clear(); dictionary.addAll(oldDictionary);
                activities.clear(); activities.addAll(oldActivities);
                audits.clear(); audits.addAll(oldAudits);
            }
        };
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
        return (T) proxy.getProxy();
    }
}
