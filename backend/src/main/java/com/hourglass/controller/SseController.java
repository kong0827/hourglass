package com.hourglass.controller;

import com.hourglass.common.CurrentUser;
import com.hourglass.service.SseService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class SseController {

    private final SseService sseService;

    public SseController(SseService sseService) {
        this.sseService = sseService;
    }

    /** 实时变更订阅（EventSource）；订阅绑定当前用户，广播按空间成员投递 */
    @GetMapping("/api/events")
    public SseEmitter events() {
        return sseService.subscribe(CurrentUser.id());
    }
}
