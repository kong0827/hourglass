package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 空间级发布维护权限：可选项由后端给出，前端只负责勾选与保存。 */
@Data
public class ReleaseAccessScopeDto {
    private List<String> selected;
    private List<Option> options;

    @Data
    public static class Option {
        private String value;
        private String label;
        private String description;

        public Option() {
        }

        public Option(String value, String label, String description) {
            this.value = value;
            this.label = label;
            this.description = description;
        }
    }
}
