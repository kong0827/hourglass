package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocReorderRequest;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocHistory;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 创建人保护（A 轻量档）回归：把草稿已有的「负责人 + 空间 owner/admin」口径扩展到已发布文档的
 * update / changeStatus / rename / delete / restore（恢复历史，覆盖正文）/ publish（发布撤回）。
 * 排序、新建子文档、分享链接不走此门控（组织/新增/分发，不改父文档内容或可见状态）。
 *
 * <p>门控是私有方法 {@code assertDocMutate}，这里通过六个公开入口验证：
 * 非负责人成员（有项目写权限）一律 403；负责人本人 / 空间管理员 / 空负责人（回退项目可写）/
 * 系统级联（userId=null）放行；项目可写门控仍先于创建人校验。
 */
class RequirementDocCreatorProtectionTest {

    private static final String WS = "W1";
    private static final String OWNER = "U1";
    private static final String OTHER = "U2";
    private static final String ADMIN = "U3";
    private static final String DOC_ID = "D1";
    private static final String REQ_ID = "R1";
    private static final String HISTORY_ID = "H1";
    private static final String GATE_MSG = "仅文档负责人或空间管理员可编辑 / 删除";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final RequirementDocHistoryMapper histories = mock(RequirementDocHistoryMapper.class);
    private final ReqDocShareMapper shares = mock(ReqDocShareMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final DeletionTraceService deletionTrace = mock(DeletionTraceService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            histories, mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            reqs, mock(UserMapper.class), tasks, mock(WorkActivityService.class), mock(DemandMapper.class), access,
            mock(NotificationEventService.class), shares, mock(WorkspaceMapper.class),
            mock(DocPreviewService.class), deletionTrace);

    @BeforeEach
    void injectFieldDependencies() {
        /* delete 会清附件；attachmentService 是 @Autowired 字段，单测手动注入 mock */
        ReflectionTestUtils.setField(service, "attachmentService", mock(AttachmentService.class));
        /* update 走 ensureProject：所属项目须存在且同空间 */
        Requirement r = new Requirement();
        r.setId(REQ_ID);
        r.setWorkspaceId(WS);
        r.setName("演示项目");
        when(reqs.selectById(REQ_ID)).thenReturn(r);
        when(docs.update(any(RequirementDoc.class), any())).thenReturn(1);
        /* restore 放行后须能取到归属一致的历史版本，否则会落到 404 而非验证门控 */
        when(histories.selectById(HISTORY_ID)).thenReturn(history());
    }

    /* ---------------- 非负责人成员：六个改删/发布/恢复入口一律 403 ---------------- */

    @ParameterizedTest
    @ValueSource(strings = {"update", "changeStatus", "rename", "delete", "restore", "publish"})
    void nonOwnerMemberIsDeniedOnEveryContentMutation(String op) {
        stubVisible(doc(OWNER, true), OTHER, "member");

        AppException ex = assertThrows(AppException.class, () -> mutate(op, OTHER));

        assertEquals(403, ex.getCode());
        assertEquals(GATE_MSG, ex.getMessage());
        verifyNoContentWrite();
    }

    /* ---------------- 负责人本人：六个入口放行 ---------------- */

    @ParameterizedTest
    @ValueSource(strings = {"update", "changeStatus", "rename", "delete", "restore", "publish"})
    void ownerCanMutateOwnPublishedDoc(String op) {
        stubVisible(doc(OWNER, true), OWNER, "member");

        assertDoesNotThrow(() -> mutate(op, OWNER));

        verifyContentWrite(op);
    }

    /* ---------------- 空间 owner/admin：可改删/发布/恢复任何文档 ---------------- */

    @ParameterizedTest
    @ValueSource(strings = {"update", "changeStatus", "rename", "delete", "restore", "publish"})
    void spaceAdminCanMutateAnyPublishedDoc(String op) {
        stubVisible(doc(OWNER, true), ADMIN, "admin");
        when(access.canManage(WS, ADMIN)).thenReturn(true);

        assertDoesNotThrow(() -> mutate(op, ADMIN));

        verifyContentWrite(op);
    }

    /* ---------------- 空负责人（历史自由文本）：回退项目可写，不锁死 ---------------- */

    @ParameterizedTest
    @ValueSource(strings = {"update", "changeStatus", "rename", "delete", "restore", "publish"})
    void nullOwnerDocFallsBackToProjectWrite(String op) {
        stubVisible(doc(null, true), OTHER, "member");

        assertDoesNotThrow(() -> mutate(op, OTHER));

        verifyContentWrite(op);
    }

    /* ---------------- 系统级联（userId=null）：跳过创建人门控 ---------------- */

    @Test
    void cascadeDeleteWithNullUserSkipsCreatorGate() {
        when(docs.selectById(DOC_ID)).thenReturn(doc(OWNER, true));

        /* 项目删除等系统级联走两参重载，userId=null */
        assertDoesNotThrow(() -> service.delete(WS, DOC_ID));

        verify(docs).delete(DOC_ID);
        verify(access, never()).canManage(anyString(), anyString());
    }

    /* ---------------- 排序不走创建人门控：成员可整理他人已发布文档 ---------------- */

    @Test
    void reorderIsNotCreatorGated() {
        stubVisible(doc(OWNER, true), OTHER, "member");

        assertDoesNotThrow(() -> service.reorder(OTHER, WS, reorderOf(DOC_ID, null)));

        verify(docs).updateSortOrder(WS, DOC_ID, 1, null);
        /* 排序只校验项目可写，绝不咨询创建人/管理员身份 */
        verify(access, never()).canManage(anyString(), anyString());
    }

    /* ---------------- 分享不走创建人门控：项目可写成员可分发他人已发布文档 ---------------- */

    @Test
    void shareIsNotCreatorGated() {
        stubVisible(doc(OWNER, true), OTHER, "member");

        /* 分享是分发已发布内容（项目/空间可写即可），与发布/改删的创建人保护区分 */
        assertDoesNotThrow(() -> service.createShare(OTHER, WS, DOC_ID));

        verify(shares).upsert(any());
        verify(access, never()).canManage(anyString(), anyString());
    }

    /* ---------------- 项目可写门控仍先于创建人校验 ---------------- */

    @Test
    void projectWriteIsRequiredBeforeCreatorCheck() {
        stubVisible(doc(OWNER, true), OWNER, "viewer");
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, OWNER, REQ_ID);

        AppException ex = assertThrows(AppException.class, () -> mutate("update", OWNER));

        /* 即便是负责人本人，项目只读也先被挡下；创建人校验短路，不再咨询 canManage */
        assertEquals(403, ex.getCode());
        assertEquals("只读", ex.getMessage());
        verify(access, never()).canManage(anyString(), anyString());
        verifyNoContentWrite();
    }

    @ParameterizedTest
    @ValueSource(strings = {"restore", "publish"})
    void projectWriteIsRequiredBeforeCreatorCheckForRestorePublish(String op) {
        stubVisible(doc(OWNER, true), OWNER, "viewer");
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, OWNER, REQ_ID);

        AppException ex = assertThrows(AppException.class, () -> mutate(op, OWNER));

        assertEquals(403, ex.getCode());
        assertEquals("只读", ex.getMessage());
        verify(access, never()).canManage(anyString(), anyString());
        verifyNoContentWrite();
    }

    /* ---------------- 草稿可见性仍先于门控：成员看不到他人草稿 ---------------- */

    @Test
    void nonOwnerMemberCannotReachOthersDraftAtAll() {
        stubVisible(doc(OWNER, false), OTHER, "member");

        AppException ex = assertThrows(AppException.class, () -> mutate("update", OTHER));

        /* 他人草稿按不存在处理（404），不会落到创建人门控的 403 */
        assertEquals(404, ex.getCode());
        verifyNoContentWrite();
    }

    /* ---------------- helpers ---------------- */

    private RequirementDoc doc(String ownerUserId, boolean published) {
        RequirementDoc d = new RequirementDoc();
        d.setId(DOC_ID);
        d.setWorkspaceId(WS);
        d.setReqId(REQ_ID);
        d.setTitle("测试文档");
        d.setDocType("other");
        d.setFormat("markdown");
        d.setContent("正文");
        d.setStatus("active");
        d.setSortOrder(0);
        d.setOwnerUserId(ownerUserId);
        d.setPublishedAt(published ? LocalDateTime.now() : null);
        return d;
    }

    private RequirementDocHistory history() {
        RequirementDocHistory h = new RequirementDocHistory();
        h.setId(HISTORY_ID);
        h.setDocId(DOC_ID);
        h.setWorkspaceId(WS);
        h.setVersionNo(1);
        h.setTitle("旧标题");
        h.setContent("旧正文");
        h.setFormat("markdown");
        return h;
    }

    private void stubVisible(RequirementDoc d, String userId, String role) {
        when(docs.selectById(DOC_ID)).thenReturn(d);
        when(access.roleOf(WS, userId)).thenReturn(role);
    }

    private ReqDocSaveRequest saveReq() {
        ReqDocSaveRequest req = new ReqDocSaveRequest();
        req.setReqId(REQ_ID);
        req.setTitle("测试文档");
        req.setContent("正文");
        req.setFormat("markdown");
        req.setStatus("active");
        return req;
    }

    private ReqDocReorderRequest reorderOf(String id, String parentId) {
        ReqDocReorderRequest req = new ReqDocReorderRequest();
        ReqDocReorderRequest.Item item = new ReqDocReorderRequest.Item();
        item.setId(id);
        item.setParentId(parentId);
        item.setSortOrder(1);
        req.setItems(Collections.singletonList(item));
        return req;
    }

    /**
     * 按操作名调用对应公开入口；update 用「同值保存」隔离门控，避免无关正文分支干扰；
     * publish 用「撤回发布」(false) 作用于已发布文档，既过门控又触发吊销分享分支。
     */
    private void mutate(String op, String userId) {
        switch (op) {
            case "update":
                service.update(userId, WS, DOC_ID, saveReq());
                break;
            case "changeStatus":
                service.changeStatus(userId, WS, DOC_ID, "done");
                break;
            case "rename":
                service.rename(userId, WS, DOC_ID, "新名");
                break;
            case "delete":
                service.delete(userId, WS, DOC_ID);
                break;
            case "restore":
                service.restore(userId, WS, DOC_ID, HISTORY_ID);
                break;
            case "publish":
                service.publish(userId, WS, DOC_ID, false);
                break;
            default:
                throw new IllegalArgumentException("未知操作：" + op);
        }
    }

    private void verifyContentWrite(String op) {
        switch (op) {
            case "update":
                verify(docs).update(any(RequirementDoc.class), any());
                break;
            case "changeStatus":
                verify(docs).updateStatus(WS, DOC_ID, "done");
                break;
            case "rename":
                verify(docs).updateTitle(WS, DOC_ID, "新名");
                break;
            case "delete":
                verify(docs).delete(DOC_ID);
                break;
            case "restore":
                /* 恢复历史经 docMapper.update 覆盖正文 */
                verify(docs).update(any(RequirementDoc.class), any());
                break;
            case "publish":
                /* 撤回发布把 published_at 置空 */
                verify(docs).updatePublished(DOC_ID, null);
                break;
            default:
                throw new IllegalArgumentException("未知操作：" + op);
        }
    }

    private void verifyNoContentWrite() {
        verify(docs, never()).update(any(RequirementDoc.class), any());
        verify(docs, never()).updateStatus(anyString(), anyString(), anyString());
        verify(docs, never()).updateTitle(anyString(), anyString(), anyString());
        verify(docs, never()).delete(anyString());
        verify(docs, never()).updatePublished(anyString(), any());
        verify(histories, never()).insert(any());
    }
}