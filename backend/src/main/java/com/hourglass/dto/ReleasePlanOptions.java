package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** 计划编辑器的项目/版本选项；只返回当前用户可管理的项目，避免选出无法保存的版本。 */
@Data
public class ReleasePlanOptions {
    private List<ProjectOption> projects = new ArrayList<ProjectOption>();

    @Data
    public static class ProjectOption {
        private String id;
        private String name;
        private List<VersionOption> versions = new ArrayList<VersionOption>();
    }

    @Data
    public static class VersionOption {
        private String id;
        private String name;
        private String status;
        private LocalDate targetDate;
    }
}
