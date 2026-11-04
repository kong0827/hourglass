package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.ProjectMember;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SSE 实时推送（服务端按空间授权）：
 * 订阅绑定用户；广播携带空间时逐个查询该空间成员，只发给成员的连接——
 * 非成员收不到该空间的任何事件，不再依赖浏览器端过滤。
 *
 * 2026-10-16 评估报告改造（O-11）：事件载荷从"纯空间ID文本"升级为 JSON
 * {"w":"空间ID","t":"任务ID","a":"操作人显示名"}，前端据此判断
 * "是不是当前打开着的那条任务被改了"，从而给出轻提示而不是静默不更新。
 * 旧格式（纯空间ID）依旧被前端兼容解析。
 */
@Service
public class SseService {

    private static final Logger log = LoggerFactory.getLogger(SseService.class);

    /** 单用户最多保留的 SSE 连接数：多标签页够用，异常重连不会无限堆积 */
    private static final int MAX_PER_USER = 5;
    /** 30 分钟主动超时：让客户端按 EventSource 规则自动重连，顺便回收半死连接 */
    private static final long EMITTER_TIMEOUT_MS = 30L * 60L * 1000L;

    /** emitter → 订阅用户ID */
    private final Map<SseEmitter, String> subscribers = new ConcurrentHashMap<SseEmitter, String>();
    private final WorkspaceMemberMapper memberMapper;
    private final TaskMapper taskMapper;
    private final RequirementDocMapper docMapper;
    private final ProjectAccessService projectAccess;
    /** 广播放到单线程有界队列：请求线程只负责投递，不被成员查询和慢连接拖住 */
    private final java.util.concurrent.ThreadPoolExecutor broadcaster =
            new java.util.concurrent.ThreadPoolExecutor(1, 1, 0L, java.util.concurrent.TimeUnit.MILLISECONDS,
                    new java.util.concurrent.ArrayBlockingQueue<Runnable>(512),
                    new java.util.concurrent.ThreadPoolExecutor.DiscardOldestPolicy());

    public SseService(WorkspaceMemberMapper memberMapper, TaskMapper taskMapper,
                      RequirementDocMapper docMapper, ProjectAccessService projectAccess) {
        this.memberMapper = memberMapper;
        this.taskMapper = taskMapper;
        this.docMapper = docMapper;
        this.projectAccess = projectAccess;
    }

    @javax.annotation.PreDestroy
    public void shutdown() {
        broadcaster.shutdownNow();
    }

    public SseEmitter subscribe(String userId) {
        evictOldestIfFull(userId);
        final SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        subscribers.put(emitter, userId);
        emitter.onCompletion(new Runnable() {
            @Override
            public void run() {
                subscribers.remove(emitter);
            }
        });
        emitter.onTimeout(new Runnable() {
            @Override
            public void run() {
                subscribers.remove(emitter);
            }
        });
        emitter.onError(new java.util.function.Consumer<Throwable>() {
            @Override
            public void accept(Throwable t) {
                subscribers.remove(emitter);
            }
        });
        try {
            emitter.send(SseEmitter.event().name("hello").data("ok"));
        } catch (IOException e) {
            subscribers.remove(emitter);
        }
        return emitter;
    }

    /** 同一用户连接达到上限时，先关掉一条旧连接（通常是崩溃后没清理的） */
    private void evictOldestIfFull(String userId) {
        int count = 0;
        SseEmitter oldest = null;
        for (Map.Entry<SseEmitter, String> e : subscribers.entrySet()) {
            if (!userId.equals(e.getValue())) {
                continue;
            }
            count++;
            if (oldest == null) {
                oldest = e.getKey();
            }
        }
        if (count >= MAX_PER_USER && oldest != null) {
            try {
                oldest.complete();
            } catch (Exception ignored) {
                /* 连接已经断了也行 */
            }
            subscribers.remove(oldest);
        }
    }

    /** 仅带空间粒度的广播（账号管理等与空间无关的变更传空串，发给全部订阅者） */
    public void broadcast(String event, String workspaceId) {
        broadcast(event, workspaceId, null, null, null, null, null);
    }

    /**
     * 带任务、操作人、发起客户端与实体类型的广播（O-11 / F-NET-1）。
     * data 为空 = 与空间无关的变更，发给全部订阅；否则仅发给该空间成员。
     * docId：reqdoc 实体携带被改文档的 ID，前端据此提示"正在编辑的文档被他人修改"。
     */
    public void broadcast(final String event, String workspaceId, String taskId, String actorName,
                          final String clientId, final String entity, String docId) {
        if (subscribers.isEmpty()) {
            return; // 没有订阅者时不查成员、直接返回
        }
        String wsId = Texts.trimToNull(workspaceId);
        String tId = Texts.trimToNull(taskId);
        String actor = Texts.trimToNull(actorName);
        final String cid = Texts.trimToNull(clientId);
        final String ent = Texts.trimToNull(entity);
        String dId = Texts.trimToNull(docId);
        // 只在确实带了任务/操作人/客户端/实体信息时才用 JSON 载荷；否则保持旧格式（纯空间ID）
        String data = wsId == null ? "" : wsId;
        if (wsId != null && (tId != null || actor != null || cid != null || ent != null)) {
            data = "{\"w\":\"" + escape(wsId) + "\""
                    + (tId == null ? "" : ",\"t\":\"" + escape(tId) + "\"")
                    + (actor == null ? "" : ",\"a\":\"" + escape(actor) + "\"")
                    + (cid == null ? "" : ",\"c\":\"" + escape(cid) + "\"")
                    + (ent == null ? "" : ",\"e\":\"" + escape(ent) + "\"")
                    + (dId == null ? "" : ",\"d\":\"" + escape(dId) + "\"") + "}";
        }
        final String payload = data;
        broadcaster.execute(new Runnable() {
            @Override
            public void run() {
                deliver(event, wsId, tId, dId, payload);
            }
        });
    }

    private void deliver(String event, String wsId, String taskId, String docId, String data) {
        Set<String> allowed = null;
        Map<String, String> roles = null;
        if (wsId != null) {
            try {
                allowed = new HashSet<String>();
                roles = new HashMap<String, String>();
                for (WorkspaceMember m : memberMapper.selectByWorkspace(wsId)) {
                    allowed.add(m.getUserId());
                    roles.put(m.getUserId(), m.getRole());
                }
            } catch (Exception e) {
                // 成员查询失败宁可少发，也绝不降级为全员广播；刷新通知不影响已成功的业务响应
                log.warn("SSE 广播成员查询失败，本次不投递：{}", wsId, e);
                return;
            }
        }
        Set<String> blocked;
        try {
            blocked = projectBlocked(wsId, taskId, docId, roles);
        } catch (Exception e) {
            // 可见范围校验失败同样不发：宁可少一次刷新提示，也不泄露不可见项目的变更
            log.warn("SSE 广播项目可见范围校验失败，本次不投递：{}", wsId, e);
            return;
        }
        for (Map.Entry<SseEmitter, String> entry : subscribers.entrySet()) {
            String uid = entry.getValue();
            if (allowed != null && !allowed.contains(uid)) {
                continue;
            }
            if (blocked.contains(uid)) {
                continue;
            }
            try {
                entry.getKey().send(SseEmitter.event().name(event).data(data));
            } catch (Exception e) {
                subscribers.remove(entry.getKey());
            }
        }
    }

    /**
     * 任务/文档事件只推给能看见其所属项目的成员：把被显式设为"不可见"的普通成员排除。
     * owner/admin/viewer 不受项目级限制（防止成员升级后残留的旧 none 记录误伤）。
     * 事件不带任务/文档或对象已不存在时不做过滤，与空间级广播一致。
     */
    Set<String> projectBlocked(String wsId, String taskId, String docId, Map<String, String> roles) {
        Set<String> blocked = new HashSet<String>();
        if (wsId == null) {
            return blocked;
        }
        String projectId = null;
        if (taskId != null) {
            Task t = taskMapper.selectById(taskId);
            if (t != null && wsId.equals(t.getWorkspaceId())) {
                projectId = t.getReqId();
            }
        } else if (docId != null) {
            RequirementDoc d = docMapper.selectById(docId);
            if (d != null && wsId.equals(d.getWorkspaceId())) {
                projectId = d.getReqId();
            }
        }
        if (projectId == null) {
            return blocked;
        }
        for (ProjectMember pm : projectAccess.grants(wsId)) {
            if (projectId.equals(pm.getProjectId())
                    && ProjectAccessService.ACCESS_NONE.equals(pm.getAccess())
                    && ProjectAccessService.ROLE_MEMBER.equals(roles.get(pm.getUserId()))) {
                blocked.add(pm.getUserId());
            }
        }
        return blocked;
    }

    private String escape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                /* 换行会拆断 SSE 的 data 行，JSON 也会失效：统一转义掉 */
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    /** 心跳：防止 nginx 等反代按空闲超时断开连接 */
    @Scheduled(fixedRate = 25000)
    public void heartbeat() {
        if (subscribers.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : subscribers.keySet()) {
            try {
                emitter.send(SseEmitter.event().name("ping").data("1"));
            } catch (Exception e) {
                subscribers.remove(emitter);
            }
        }
    }
}
