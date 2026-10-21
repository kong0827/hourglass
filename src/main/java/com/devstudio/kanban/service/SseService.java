package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
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

    /** emitter → 订阅用户ID */
    private final Map<SseEmitter, String> subscribers = new ConcurrentHashMap<SseEmitter, String>();
    private final WorkspaceMemberMapper memberMapper;

    public SseService(WorkspaceMemberMapper memberMapper) {
        this.memberMapper = memberMapper;
    }

    public SseEmitter subscribe(String userId) {
        final SseEmitter emitter = new SseEmitter(0L);
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

    /** 仅带空间粒度的广播（账号管理等与空间无关的变更传空串，发给全部订阅者） */
    public void broadcast(String event, String workspaceId) {
        broadcast(event, workspaceId, null, null);
    }

    /**
     * 带任务与操作人的广播（O-11）。
     * data 为空 = 与空间无关的变更，发给全部订阅；否则仅发给该空间成员。
     */
    public void broadcast(String event, String workspaceId, String taskId, String actorName) {
        if (subscribers.isEmpty()) {
            return; // 没有订阅者时不查成员、直接返回
        }
        String wsId = Texts.trimToNull(workspaceId);
        String tId = Texts.trimToNull(taskId);
        String actor = Texts.trimToNull(actorName);
        // 只在确实带了任务信息时才用 JSON 载荷；否则保持旧格式（纯空间ID），避免前端解析歧义
        String data = wsId == null ? "" : wsId;
        if (wsId != null && (tId != null || actor != null)) {
            data = "{\"w\":\"" + escape(wsId) + "\""
                    + (tId == null ? "" : ",\"t\":\"" + escape(tId) + "\"")
                    + (actor == null ? "" : ",\"a\":\"" + escape(actor) + "\"") + "}";
        }

        Set<String> allowed = null;
        if (wsId != null) {
            try {
                allowed = new HashSet<String>();
                for (WorkspaceMember m : memberMapper.selectByWorkspace(wsId)) {
                    allowed.add(m.getUserId());
                }
            } catch (Exception e) {
                // 成员查询失败宁可少发，也绝不降级为全员广播；刷新通知不影响已成功的业务响应
                log.warn("SSE 广播成员查询失败，本次不投递：{}", wsId, e);
                return;
            }
        }
        for (Map.Entry<SseEmitter, String> entry : subscribers.entrySet()) {
            if (allowed != null && !allowed.contains(entry.getValue())) {
                continue;
            }
            try {
                entry.getKey().send(SseEmitter.event().name(event).data(data));
            } catch (Exception e) {
                subscribers.remove(entry.getKey());
            }
        }
    }

    private String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
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
