package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ReqDocCommentRequest;
import com.hourglass.dto.ReqDocCommentView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocComment;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/** 文档评论：查看文档即可阅读；当前项目可写者可发表评论和删除评论。 */
@Service
public class RequirementDocCommentService {

    private final RequirementDocCommentMapper commentMapper;
    private final RequirementDocMapper docMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;
    /** 评论是硬删除：文档轨迹留一句，独立审计保留「谁删了」 */
    private final WorkActivityService workActivityService;
    private final AuditService auditService;

    public RequirementDocCommentService(RequirementDocCommentMapper commentMapper,
                                        RequirementDocMapper docMapper,
                                        UserMapper userMapper,
                                        ProjectAccessService projectAccess,
                                        WorkActivityService workActivityService,
                                        AuditService auditService) {
        this.commentMapper = commentMapper;
        this.docMapper = docMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
        this.workActivityService = workActivityService;
        this.auditService = auditService;
    }

    public com.hourglass.dto.PageResult<ReqDocCommentView> list(String workspaceId, String userId, String docId,
                                                                 int offset, int limit) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(100, limit));
        int total = commentMapper.countByDoc(workspaceId, docId);
        List<RequirementDocComment> rows = total <= safeOffset ? new ArrayList<RequirementDocComment>()
                : commentMapper.selectByDoc(workspaceId, docId, safeOffset, safeLimit);

        java.util.Set<String> userIds = new java.util.LinkedHashSet<String>();
        for (RequirementDocComment row : rows) {
            if (row.getUserId() != null) {
                userIds.add(row.getUserId());
            }
        }
        java.util.Map<String, String> userNames = new java.util.HashMap<String, String>();
        if (!userIds.isEmpty()) {
            for (AppUser user : userMapper.selectByIds(new ArrayList<String>(userIds))) {
                userNames.put(user.getId(), user.getDisplayName());
            }
        }
        boolean deletable = !rows.isEmpty() && projectAccess.canWrite(workspaceId, userId, doc.getReqId());
        List<ReqDocCommentView> views = new ArrayList<ReqDocCommentView>(rows.size());
        for (RequirementDocComment row : rows) {
            views.add(toView(row, userNames.get(row.getUserId()), deletable));
        }
        return com.hourglass.dto.PageResult.of(views, total, safeOffset, safeLimit);
    }

    @Transactional
    public ReqDocCommentView create(String userId, String workspaceId, String docId, ReqDocCommentRequest req) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        projectAccess.assertWrite(workspaceId, userId, doc.getReqId());
        RequirementDocComment c = new RequirementDocComment();
        c.setId(Ids.gen("DC"));
        c.setWorkspaceId(workspaceId);
        c.setDocId(docId);
        c.setUserId(userId);
        c.setContent(Texts.trimToNull(req.getContent()));
        c.setQuoteText(Texts.trimToNull(req.getQuoteText()));
        if (c.getContent() == null) {
            throw AppException.badRequest("评论内容不能为空");
        }
        commentMapper.insert(c);
        return toView(c, workspaceId, userId, doc.getReqId());
    }

    @Transactional
    public void delete(String userId, String workspaceId, String docId, String commentId) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        RequirementDocComment c = commentMapper.selectById(commentId);
        if (c == null || !workspaceId.equals(c.getWorkspaceId()) || !docId.equals(c.getDocId())) {
            throw AppException.notFound("评论不存在：" + commentId);
        }
        projectAccess.assertWrite(workspaceId, userId, doc.getReqId());
        commentMapper.delete(workspaceId, commentId);
        workActivityService.record(workspaceId, WorkActivityService.REQUIREMENT_DOC, docId, userId,
                "update", "删除了一条评论");
        auditService.recordCurrent(workspaceId, "comment_delete", "comment", commentId, doc.getTitle(), true,
                "删除文档「" + doc.getTitle() + "」下的一条评论", null);
    }

    private RequirementDoc requireVisibleDoc(String workspaceId, String userId, String docId) {
        RequirementDoc doc = docMapper.selectById(docId);
        if (doc == null || !workspaceId.equals(doc.getWorkspaceId())) {
            throw AppException.notFound("文档不存在：" + docId);
        }
        projectAccess.assertView(workspaceId, userId, doc.getReqId());
        /* 草稿的评论与文档同口径：仅作者与空间 owner/admin 可读，其余按不存在处理 */
        if (!RequirementDocService.canSeeDraft(doc.getOwnerUserId(), doc.getPublishedAt(), userId,
                projectAccess.roleOf(workspaceId, userId))) {
            throw AppException.notFound("文档不存在：" + docId);
        }
        return doc;
    }

    private ReqDocCommentView toView(RequirementDocComment c, String workspaceId, String actorId, String docReqId) {
        AppUser user = userMapper.selectById(c.getUserId());
        return toView(c, user == null ? null : user.getDisplayName(),
                projectAccess.canWrite(workspaceId, actorId, docReqId));
    }

    private ReqDocCommentView toView(RequirementDocComment c, String userName, boolean deletable) {
        ReqDocCommentView v = new ReqDocCommentView();
        v.setId(c.getId());
        v.setUserId(c.getUserId());
        v.setUserName(userName == null ? "—" : Texts.cut(userName, 32));
        v.setContent(c.getContent());
        v.setQuoteText(c.getQuoteText());
        v.setCreatedAt(c.getCreatedAt());
        v.setDeletable(deletable);
        return v;
    }
}
