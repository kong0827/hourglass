package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.dto.ProjectTemplateView;
import com.hourglass.service.ProjectTemplateService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class ProjectTemplateController {

    private final ProjectTemplateService templateService;

    public ProjectTemplateController(ProjectTemplateService templateService) {
        this.templateService = templateService;
    }

    /** 内置项目模板：新建项目时选择，按需补齐列/文档/测试模块/默认版本 */
    @GetMapping("/api/project-templates")
    public ApiResult<List<ProjectTemplateView>> list() {
        return ApiResult.ok(templateService.list());
    }
}
