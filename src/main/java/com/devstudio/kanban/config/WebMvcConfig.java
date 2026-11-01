package com.devstudio.kanban.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/** 注册自定义参数解析器（BE-ARCH-2） */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final WorkspaceArgumentResolver workspaceResolver;
    private final BoardQueryArgumentResolver boardQueryResolver;

    public WebMvcConfig(WorkspaceArgumentResolver workspaceResolver,
                        BoardQueryArgumentResolver boardQueryResolver) {
        this.workspaceResolver = workspaceResolver;
        this.boardQueryResolver = boardQueryResolver;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(workspaceResolver);
        resolvers.add(boardQueryResolver);
    }
}
