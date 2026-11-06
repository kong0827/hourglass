package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.ReqDocCommentRequest;
import com.devstudio.kanban.dto.ReqDocCommentView;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.RequirementDocComment;
import com.devstudio.kanban.mapper.RequirementDocCommentMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/** 文档评论：查看文档即可阅读；非查看者角色可发表评论；评论作者或项目可写者可删除。 */
@Service
public class RequirementDocCommentService {

    private final RequirementDocCommentMapper commentMapper;
    private final RequirementDocMapper docMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;

    public RequirementDocCommentService(RequirementDocCommentMapper commentMapper,
                                        RequirementDocMapper docMapper,
                                        UserMapper userMapper,
                                        ProjectAccessService projectAccess) {
        this.commentMapper = commentMapper;
        this.docMapper = docMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
    }

    public List<ReqDocCommentView> list(String workspaceId, String userId, String docId) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        List<RequirementDocComment> rows = commentMapper.selectByDoc(workspaceId, docId);
        List<ReqDocCommentView> views = new ArrayList<ReqDocCommentView>(rows.size());
        for (RequirementDocComment c : rows) {
            views.add(toView(c, workspaceId, userId, doc.getReqId()));
        }
        return views;
    }

    @Transactional
    public ReqDocCommentView create(String userId, String workspaceId, String docId, ReqDocCommentRequest req) {
        RequirementDoc doc = requireVisibleDoc(workspaceId, userId, docId);
        String role = projectAccess.roleOf(workspaceId, userId);
        if (ProjectAccessService.isViewer(role)) {
            throw new AppException(403, "查看者只能阅读文档，不能发表评论");
        }
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
        if (!userId.equals(c.getUserId()) && !projectAccess.canWrite(workspaceId, userId, doc.getReqId())) {
            throw new AppException(403, "只有评论作者或项目可写者可删除评论");
        }
        commentMapper.delete(workspaceId, commentId);
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
        ReqDocCommentView v = new ReqDocCommentView();
        v.setId(c.getId());
        v.setUserId(c.getUserId());
        AppUser u = userMapper.selectById(c.getUserId());
        v.setUserName(u == null ? "—" : Texts.cut(u.getDisplayName(), 32));
        v.setContent(c.getContent());
        v.setQuoteText(c.getQuoteText());
        v.setCreatedAt(c.getCreatedAt());
        v.setDeletable(actorId.equals(c.getUserId()) || projectAccess.canWrite(workspaceId, actorId, docReqId));
        return v;
    }
}
