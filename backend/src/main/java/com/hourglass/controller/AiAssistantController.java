package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.AppException;
import com.hourglass.common.CurrentUser;
import com.hourglass.dto.AiAssistantBootstrapView;
import com.hourglass.dto.AiAssistantConfirmRequest;
import com.hourglass.dto.AiAssistantConfirmResponse;
import com.hourglass.dto.AiAssistantFeedbackRequest;
import com.hourglass.dto.AiAssistantRequest;
import com.hourglass.dto.AiAssistantResponse;
import com.hourglass.entity.Workspace;
import com.hourglass.service.AiAssistantService;
import com.hourglass.service.AiUsageService;
import com.hourglass.service.AuditService;
import com.hourglass.service.WorkspaceService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.function.Consumer;

/**
 * 产品内助手：问答、入口建议、任务草稿与确认创建。
 *
 * <p>空间一律由 {@link WorkspaceService#resolve} 解析并校验成员身份；
 * 助手不会读取请求里的任意项目 ID，所有项目都在服务层按可见范围重新过滤。
 */
@RestController
public class AiAssistantController {

    private static final long STREAM_TIMEOUT_MS = 200000L;
    private static final DateTimeFormatter STATS_TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    /** 流式回答单独两条线程：与 AiClient 的 2 个并发槽对齐，不占 Tomcat 请求线程 */
    private static final ExecutorService STREAM_POOL = Executors.newFixedThreadPool(2, new ThreadFactory() {
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "ai-chat-stream");
            t.setDaemon(true);
            return t;
        }
    });

    private final AiAssistantService assistantService;
    private final WorkspaceService workspaceService;
    private final AuditService audit;
    private final AiUsageService usageService;

    public AiAssistantController(AiAssistantService assistantService, WorkspaceService workspaceService,
                                 AuditService audit, AiUsageService usageService) {
        this.assistantService = assistantService;
        this.workspaceService = workspaceService;
        this.audit = audit;
        this.usageService = usageService;
    }

    @GetMapping("/api/ai/assistant/bootstrap")
    public ApiResult<AiAssistantBootstrapView> bootstrap(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        return ApiResult.ok(assistantService.bootstrap(userId, ws.getId(), ws.getName()));
    }

    @PostMapping("/api/ai/assistant/chat")
    public ApiResult<AiAssistantResponse> chat(@Valid @RequestBody AiAssistantRequest req,
                                               @RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        long started = System.currentTimeMillis();
        try {
            AiAssistantResponse res = assistantService.chat(userId, ws.getId(), ws.getName(), req);
            fillProvenance(res);
            usageService.record(ws.getId(), usageIntent(res), res.getUsage(), true, elapsed(started));
            return ApiResult.ok(res);
        } catch (RuntimeException e) {
            usageService.record(ws.getId(), "error", null, false, elapsed(started));
            throw e;
        }
    }

    /**
     * 流式回答：先发 open，正文边生成边发 delta，完整结构化结果最后以 final 一次下发。
     * 前端拿不到流（旧版本/代理缓冲/网络异常）时会回退到普通 /chat。
     */
    @PostMapping("/api/ai/assistant/chat/stream")
    public SseEmitter chatStream(@Valid @RequestBody final AiAssistantRequest req,
                                 @RequestParam(required = false) String workspace,
                                 HttpServletResponse response) {
        final String userId = CurrentUser.id();
        final Workspace ws = workspaceService.resolve(userId, workspace);
        /* 让 nginx 不缓冲：否则 token 会攒到结束才一次性到达 */
        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache, no-transform");
        final SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        final long started = System.currentTimeMillis();
        final long[] lastSentAt = { 0L };
        final String[] lastText = { "" };
        STREAM_POOL.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    emitter.send(SseEmitter.event().name("open").data("ok"));
                    AiAssistantResponse res = assistantService.chat(userId, ws.getId(), ws.getName(), req,
                            new Consumer<String>() {
                                @Override
                                public void accept(String text) {
                                    long now = System.currentTimeMillis();
                                    /* 60ms 节流：JSON 抽取是累计文本，重复帧不再发 */
                                    if (now - lastSentAt[0] < 60 || text.equals(lastText[0])) {
                                        return;
                                    }
                                    lastSentAt[0] = now;
                                    lastText[0] = text;
                                    try {
                                        emitter.send(SseEmitter.event().name("delta")
                                                .data(Collections.singletonMap("text", text),
                                                        MediaType.APPLICATION_JSON));
                                    } catch (Exception e) {
                                        throw new StreamClosedException(e);
                                    }
                                }
                            });
                    fillProvenance(res);
                    try {
                        emitter.send(SseEmitter.event().name("final")
                                .data(res, MediaType.APPLICATION_JSON));
                    } catch (Exception ignored) {
                        /* 客户端已断开：回答算完成，仍然记用量 */
                    }
                    emitter.complete();
                    usageService.record(ws.getId(), usageIntent(res), res.getUsage(), true, elapsed(started));
                } catch (StreamClosedException e) {
                    emitter.completeWithError(e.getCause());
                } catch (Throwable e) {
                    usageService.record(ws.getId(), "error", null, false, elapsed(started));
                    try {
                        Map<String, Object> err = new LinkedHashMap<String, Object>();
                        err.put("code", e instanceof AppException ? ((AppException) e).getCode() : 500);
                        err.put("message", e instanceof AppException
                                ? e.getMessage() : "助手暂时不可用，请稍后重试");
                        emitter.send(SseEmitter.event().name("error")
                                .data(err, MediaType.APPLICATION_JSON));
                    } catch (Exception ignored) {
                        /* 连接已断，事件发不出去 */
                    }
                    emitter.complete();
                }
            }
        });
        return emitter;
    }

    @PostMapping("/api/ai/assistant/feedback")
    public ApiResult<Void> feedback(@Valid @RequestBody AiAssistantFeedbackRequest req,
                                    @RequestParam(required = false) String workspace,
                                    HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 只留评价与回答类型，不落用户原话或回答正文 */
        audit.recordCurrent(ws.getId(), "ai_assistant_feedback", "assistant",
                req.getQueryType(), req.getIntent(), req.getHelpful() == 1,
                req.getHelpful() == 1 ? "AI 助手回答被评价为有用" : "AI 助手回答被评价为没用", request);
        return ApiResult.ok(null);
    }

    @PostMapping("/api/ai/assistant/tasks/confirm")
    public ApiResult<AiAssistantConfirmResponse> confirm(@Valid @RequestBody AiAssistantConfirmRequest req,
                                                         @RequestParam(required = false) String workspace,
                                                         HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        /* 业务留痕（task_log / demand_log）由复用的服务写入；这里另记一条系统审计，标明是经 AI 助手确认执行的，失败也留痕 */
        AiAssistantConfirmResponse out;
        try {
            out = assistantService.confirm(userId, ws.getId(), req);
        } catch (AppException e) {
            audit.recordCurrent(ws.getId(), "ai_assistant_exec", "assistant", req.getRequestId(), null, false,
                    "AI 助手确认执行被拒绝（" + e.getCode() + "）：" + e.getMessage(), request);
            throw e;
        }
        String targetId = "demand".equals(out.getKind()) ? out.getDemandId() : out.getTaskId();
        audit.recordCurrent(ws.getId(), "ai_assistant_exec", out.getKind(), targetId, out.getTitle(), true,
                "AI 助手确认执行：" + out.getMessage(), request);
        return ApiResult.ok(out);
    }

    /** 查询结果由工具层标注；其余路径在这里补上「数据是什么时候的、从哪来的」 */
    private static void fillProvenance(AiAssistantResponse res) {
        if (res == null) {
            return;
        }
        if (res.getAsOf() == null) {
            res.setAsOf(LocalDateTime.now().format(STATS_TS));
        }
        if (res.getSourceLabel() == null) {
            if ("query".equals(res.getIntent())) {
                res.setSourceLabel("只读查询");
            } else if (res.isDegraded()) {
                res.setSourceLabel("帮助与站内规则");
            } else {
                res.setSourceLabel("AI 归纳");
            }
        }
    }

    private static String usageIntent(AiAssistantResponse res) {
        if (res == null) {
            return "error";
        }
        String q = res.getQueryType();
        if (q != null && !q.trim().isEmpty()) {
            return "query:" + q;
        }
        String intent = res.getIntent();
        return intent == null || intent.trim().isEmpty() ? "unknown" : intent;
    }

    private static long elapsed(long started) {
        return Math.max(0, System.currentTimeMillis() - started);
    }

    /** 客户端断开时从 delta 回调里抛出，终止上游读取并安静收尾 */
    private static class StreamClosedException extends RuntimeException {
        StreamClosedException(Throwable cause) {
            super(cause);
        }
    }
}
